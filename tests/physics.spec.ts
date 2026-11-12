import { test, expect } from "@playwright/test";
import { FixedStep } from "../src/core/FixedStep";
import { PhysicsWorld } from "../src/physics/PhysicsWorld";
import { Track } from "../src/track/Track";
import { VehiclePhysics } from "../src/vehicle/VehiclePhysics";
import { emptyInput } from "../src/vehicle/config";
import type { DriverInput } from "../src/vehicle/config";
import { VEHICLE } from "../src/vehicle/config";

test("fixed simulation rate is independent of 30/60/144 Hz rendering", () => {
  for (const fps of [30, 60, 144]) {
    const clock = new FixedStep();
    let steps = 0;
    for (let frame = 0; frame < fps * 3; frame++) clock.advance(1 / fps, () => steps++);
    expect(steps).toBe(180);
  }
});

test("long stalls have bounded catch-up and reset discards accumulated time", () => {
  const clock = new FixedStep();
  let steps = 0;
  clock.advance(30, () => steps++);
  expect(steps).toBe(5);
  clock.advance(1 / 120, () => steps++);
  clock.reset();
  const alpha = clock.advance(1 / 120, () => steps++);
  expect(steps).toBe(5);
  expect(alpha).toBeCloseTo(0.5);
});

async function setup() {
  const track = new Track();
  const physics = await PhysicsWorld.create(track);
  const vehicle = new VehiclePhysics(physics.world, track);
  const step = (count: number, input: DriverInput = emptyInput()) => {
    for (let i = 0; i < count; i++) {
      vehicle.beforeStep(1 / 60, input);
      physics.step(1 / 60);
      vehicle.afterStep(1 / 60);
    }
  };
  step(120);
  return { track, physics, vehicle, step };
}

test("four-wheel suspension settles and throttle accelerates a dynamic chassis", async () => {
  const { physics, vehicle, step } = await setup();
  try {
    expect(vehicle.body.isDynamic()).toBe(true);
    expect(vehicle.groundedWheels).toBe(4);
    expect(vehicle.position.y).toBeGreaterThan(0.4);
    expect(vehicle.position.y).toBeLessThan(0.8);
    const initial = vehicle.position.clone();
    step(180, { throttle: 1, brake: 0, steer: 0 });
    expect(vehicle.speed).toBeGreaterThan(10);
    expect(vehicle.position.distanceTo(initial)).toBeGreaterThan(15);
    expect(vehicle.groundedWheels).toBe(4);
  } finally {
    physics.dispose();
  }
});

test("continuous barriers stop a driven chassis crossing the road edge", async () => {
  const { physics, vehicle, track, step } = await setup();
  try {
    const s = track.samples[10],
      yaw = Math.atan2(s.tx, s.tz) + Math.PI / 2;
    vehicle.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    vehicle.afterStep(0);
    step(240, { throttle: 1, brake: 0, steer: 0 });
    const nearest = track.samples[track.nearest(vehicle.position.x, vehicle.position.z)];
    expect(physics.collisionCount).toBeGreaterThan(0);
    expect(Math.hypot(vehicle.position.x - nearest.x, vehicle.position.z - nearest.z)).toBeLessThan(
      track.width / 2 + 1,
    );
    expect(Math.abs(vehicle.speed)).toBeLessThan(2);
  } finally {
    physics.dispose();
  }
});

test("a driver using normalized controls can complete the closed track without crossing barriers", async () => {
  const { physics, vehicle, track, step } = await setup();
  try {
    let progress = 0,
      last = track.nearest(vehicle.position.x, vehicle.position.z),
      maxOffset = 0;
    const input = emptyInput();
    for (let frame = 0; frame < 5400 && progress < track.samples.length; frame++) {
      const nearest = track.nearest(vehicle.position.x, vehicle.position.z);
      let delta = nearest - last;
      if (delta > track.samples.length / 2) delta -= track.samples.length;
      if (delta < -track.samples.length / 2) delta += track.samples.length;
      progress += delta;
      last = nearest;
      const lookahead = Math.max(
        4,
        Math.round((12 + Math.abs(vehicle.speed) * 0.6) / (track.length / track.samples.length)),
      );
      const target = track.samples[(nearest + lookahead) % track.samples.length];
      const q = vehicle.rotation;
      const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      const dx = target.x - vehicle.position.x,
        dz = target.z - vehicle.position.z;
      const error = Math.atan2(
        Math.sin(Math.atan2(dx, dz) - heading),
        Math.cos(Math.atan2(dx, dz) - heading),
      );
      const angle = Math.atan((2 * 2.64 * Math.sin(error)) / Math.hypot(dx, dz));
      const limit = VEHICLE.maxSteer / (1 + (Math.abs(vehicle.speed) / 15) ** 2);
      input.steer = Math.max(-1, Math.min(1, angle / limit));
      input.throttle = Math.max(0, Math.min(1, (20 - vehicle.speed) * 0.4));
      input.brake = vehicle.speed > 22 ? 0.15 : 0;
      step(1, input);
      const center = track.samples[nearest];
      maxOffset = Math.max(
        maxOffset,
        Math.hypot(center.x - vehicle.position.x, center.z - vehicle.position.z),
      );
    }
    expect(progress).toBeGreaterThanOrEqual(track.samples.length);
    expect(physics.collisionCount).toBe(0);
    expect(maxOffset).toBeLessThan(track.width / 2 - 1);
    expect(vehicle.groundedWheels).toBe(4);
  } finally {
    physics.dispose();
  }
});

test("the same steering input yaws in opposite directions when reversing", async () => {
  for (const reverse of [false, true]) {
    const { physics, vehicle, step } = await setup();
    try {
      const input = { throttle: reverse ? 0 : 1, brake: reverse ? 1 : 0, steer: 0 };
      step(90, input);
      const yaw = (q: typeof vehicle.rotation) =>
        Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      const before = yaw(vehicle.rotation);
      input.steer = 0.5;
      step(30, input);
      const difference = Math.atan2(
        Math.sin(yaw(vehicle.rotation) - before),
        Math.cos(yaw(vehicle.rotation) - before),
      );
      expect(difference * (reverse ? -1 : 1)).toBeGreaterThan(0.025);
    } finally {
      physics.dispose();
    }
  }
});

test("braking precedes reverse, reverse is limited, and W brakes reverse motion", async () => {
  const { physics, vehicle, step } = await setup();
  try {
    step(150, { throttle: 1, brake: 0, steer: 0 });
    const forwardSpeed = vehicle.speed;
    step(15, { throttle: 0, brake: 1, steer: 0 });
    expect(vehicle.speed).toBeGreaterThan(0);
    expect(vehicle.speed).toBeLessThan(forwardSpeed);
    expect(vehicle.gear).toBeGreaterThan(0);
    step(240, { throttle: 0, brake: 1, steer: 0 });
    expect(vehicle.gear).toBe(-1);
    expect(vehicle.speed).toBeLessThan(-2);
    expect(vehicle.speed).toBeGreaterThan(-9.5);
    step(10, { throttle: 1, brake: 0, steer: 0 });
    expect(vehicle.speed).toBeLessThan(0);
    expect(vehicle.brake).toBeGreaterThan(0);
    step(180, { throttle: 1, brake: 0, steer: 0 });
    expect(vehicle.gear).toBeGreaterThan(0);
    expect(vehicle.speed).toBeGreaterThan(1);
  } finally {
    physics.dispose();
  }
});

test("steering is progressive, turns the chassis, and reset clears motion", async () => {
  const { physics, vehicle, step } = await setup();
  try {
    step(70, { throttle: 1, brake: 0, steer: 0 });
    const before = vehicle.rotation.clone();
    step(1, { throttle: 0.4, brake: 0, steer: 1 });
    expect(vehicle.steer).toBeGreaterThan(0);
    expect(vehicle.steer).toBeLessThan(0.1);
    step(45, { throttle: 0.4, brake: 0, steer: 1 });
    expect(before.angleTo(vehicle.rotation)).toBeGreaterThan(0.1);
    const steer = vehicle.steer;
    step(1, { throttle: 0, brake: 0, steer: -1 });
    expect(vehicle.steer).toBeGreaterThan(0);
    expect(vehicle.steer).toBeLessThan(steer);
    vehicle.reset(true);
    expect(vehicle.speed).toBe(0);
    expect(vehicle.body.linvel()).toEqual({ x: 0, y: 0, z: 0 });
    expect(vehicle.previousPosition.distanceTo(vehicle.position)).toBe(0);
    step(120);
    expect(vehicle.groundedWheels).toBe(4);
  } finally {
    physics.dispose();
  }
});
