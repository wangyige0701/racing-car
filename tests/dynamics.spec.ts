import { test, expect } from "@playwright/test";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three/webgpu";
import { Track } from "../src/track/Track";
import { VehiclePhysics } from "../src/vehicle/VehiclePhysics";
import { emptyInput, VEHICLE } from "../src/vehicle/config";
import type { DriverInput } from "../src/vehicle/config";

// An open flat pad isolates tire behaviour from barrier impacts and track curvature.
async function pad() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
  const vehicle = new VehiclePhysics(world, new Track());
  const step = (frames: number, input: Partial<DriverInput> = {}) => {
    const controls = { ...emptyInput(), ...input };
    for (let i = 0; i < frames; i++) {
      vehicle.beforeStep(1 / 60, controls);
      world.timestep = 1 / 60;
      world.step();
      vehicle.afterStep(1 / 60);
    }
  };
  step(120);
  return { world, vehicle, step };
}

test("handbrake creates physical sideslip and grip recovers progressively after release", async () => {
  const peaks: number[] = [];
  for (const handbrake of [0, 1]) {
    const { world, vehicle, step } = await pad();
    try {
      step(160, { throttle: 1 });
      let peak = 0;
      for (let frame = 0; frame < 60; frame++) {
        step(1, { throttle: 0.35, steer: 0.85, handbrake });
        peak = Math.max(peak, Math.abs(vehicle.drift.slipAngle));
      }
      peaks.push(peak);
      if (handbrake) {
        expect(vehicle.drift.duration).toBeGreaterThan(0.1);
        const grip = vehicle.drift.rearGrip;
        expect(grip).toBeLessThan(0.55);
        step(1);
        expect(vehicle.drift.rearGrip).toBeGreaterThan(grip);
        expect(vehicle.drift.rearGrip).toBeLessThan(grip + 0.06);
        for (let frame = 0; frame < 240; frame++) {
          step(1, { steer: -Math.max(-0.65, Math.min(0.65, vehicle.drift.slipAngle * 1.8)) });
        }
        expect(vehicle.speed).toBeGreaterThan(1);
        expect(vehicle.drift.rearGrip).toBeGreaterThan(0.99);
        expect(Math.abs(vehicle.drift.slipAngle)).toBeLessThan(0.1);
        expect(vehicle.drift.active).toBe(false);
        expect(vehicle.groundedWheels).toBe(4);
      }
    } finally {
      world.free();
    }
  }
  expect(peaks[1]).toBeGreaterThan(0.16);
  expect(peaks[1]).toBeLessThan(Math.PI / 3);
  expect(peaks[1]).toBeGreaterThan(peaks[0] * 1.5);
});

test("handbrake alone brakes without reverse or false stationary drift; reset clears drift", async () => {
  const { world, vehicle, step } = await pad();
  try {
    step(160, { throttle: 1 });
    const speed = vehicle.speed;
    step(600, { handbrake: 1 });
    expect(Math.abs(vehicle.speed)).toBeLessThan(0.5);
    expect(vehicle.speed).toBeLessThan(speed);
    expect(vehicle.gear).toBeGreaterThan(0);
    expect(vehicle.drift.active).toBe(false);
    expect(vehicle.drift.duration).toBe(0);
    vehicle.reset(true);
    expect(vehicle.handbrake).toBe(0);
    expect(vehicle.drift.rearGrip).toBe(1);
    expect(vehicle.drift.duration).toBe(0);
    expect(vehicle.drift.slipAngle).toBe(0);
    expect(vehicle.wheelAngles).toEqual([0, 0, 0, 0]);
  } finally {
    world.free();
  }
});

test("throttle plus service brake spins the driven wheels and releases into a charged launch", async () => {
  const { world, vehicle, step } = await pad();
  try {
    const start = vehicle.rotation.clone();
    step(90, { throttle: 1, brake: 1, steer: 0.7 });
    expect(vehicle.burnout).toBe(true);
    expect(vehicle.launchCharge).toBeGreaterThan(0.7);
    expect(vehicle.rpm).toBeGreaterThan(5000);
    expect(Math.abs(vehicle.speed)).toBeLessThan(3);
    expect(start.angleTo(vehicle.rotation)).toBeGreaterThan(0.1);
    step(45, { throttle: 1, steer: 0.7 });
    expect(vehicle.burnout).toBe(false);
    expect(vehicle.speed).toBeGreaterThan(7);
    expect(vehicle.launchCharge).toBeLessThan(0.1);
    expect(vehicle.groundedWheels).toBe(4);
  } finally {
    world.free();
  }
});

test("held throttle, handbrake and steering power a low-speed pivot and a sustained corner drift", async () => {
  const { world, vehicle, step } = await pad();
  try {
    const start = vehicle.rotation.clone();
    const frontAtStart = vehicle.position
      .clone()
      .add(new Vector3(0, 0, VEHICLE.wheelConnections[0].z).applyQuaternion(vehicle.rotation));
    const rearAtStart = vehicle.position
      .clone()
      .add(new Vector3(0, 0, VEHICLE.wheelConnections[2].z).applyQuaternion(vehicle.rotation));
    step(120, { throttle: 1, handbrake: 1, steer: 0.8 });
    const frontTravel = frontAtStart.distanceTo(
      vehicle.position
        .clone()
        .add(new Vector3(0, 0, VEHICLE.wheelConnections[0].z).applyQuaternion(vehicle.rotation)),
    );
    const rearTravel = rearAtStart.distanceTo(
      vehicle.position
        .clone()
        .add(new Vector3(0, 0, VEHICLE.wheelConnections[2].z).applyQuaternion(vehicle.rotation)),
    );
    expect(vehicle.drift.active).toBe(true);
    expect(vehicle.drift.pivoting).toBe(true);
    expect(vehicle.drift.rearGrip).toBeLessThan(0.5);
    expect(start.angleTo(vehicle.rotation)).toBeGreaterThan(0.6);
    expect(Math.abs(vehicle.speed)).toBeLessThan(5);
    expect(rearTravel).toBeGreaterThan(0.8);
    expect(frontTravel).toBeLessThan(rearTravel * 0.7);

    vehicle.reset(true);
    step(240, { throttle: 1 });
    const before = vehicle.position.clone();
    let activeFrames = 0;
    for (let i = 0; i < 240; i++) {
      step(1, { throttle: 1, handbrake: 1, steer: 0.7 });
      if (vehicle.drift.active) activeFrames++;
    }
    expect(activeFrames).toBeGreaterThan(200);
    expect(vehicle.speed).toBeGreaterThan(5);
    expect(vehicle.position.distanceTo(before)).toBeGreaterThan(18);
    expect(Math.abs(vehicle.drift.slipAngle)).toBeGreaterThan(0.08);
    expect(vehicle.groundedWheels).toBe(4);
    expect(vehicle.drift.pivoting).toBe(false);

    step(90, { throttle: 1, handbrake: 1, steer: -0.7 });
    expect(vehicle.drift.active).toBe(true);
    expect(vehicle.steer).toBeGreaterThan(0.08);
    expect(vehicle.speed).toBeGreaterThan(5);
    expect(vehicle.drift.pivoting).toBe(false);
  } finally {
    world.free();
  }
});

test("service brake sheds speed quickly before reverse can engage", async () => {
  const { world, vehicle, step } = await pad();
  try {
    step(180, { throttle: 1 });
    const entry = vehicle.speed;
    step(30, { brake: 1 });
    expect(vehicle.speed).toBeLessThan(entry * 0.35);
    expect(vehicle.gear).toBeGreaterThan(0);
  } finally {
    world.free();
  }
});

test("sideways motion cannot select reverse before the chassis has stopped", async () => {
  const { world, vehicle, step } = await pad();
  try {
    const lateral = new Vector3(20, 0, 0).applyQuaternion(vehicle.rotation);
    vehicle.body.setLinvel(lateral, true);
    vehicle.afterStep(0);
    expect(Math.abs(vehicle.speed)).toBeLessThan(0.1);
    step(20, { brake: 1, handbrake: 1 });
    expect(new Vector3().copy(vehicle.body.linvel()).length()).toBeGreaterThan(1);
    expect(vehicle.gear).toBeGreaterThan(0);
    expect(vehicle.brake).toBe(1);
  } finally {
    world.free();
  }
});

test("high speed steering remains bounded and suspension settles after a landing", async () => {
  const { world, vehicle, step } = await pad();
  try {
    step(600, { throttle: 1 });
    expect(vehicle.speed).toBeGreaterThan(35);
    for (let frame = 0; frame < 180; frame++) {
      step(1, { throttle: 0.5, steer: frame < 90 ? 1 : -1 });
      const up = new Vector3(0, 1, 0).applyQuaternion(vehicle.rotation);
      expect(up.y).toBeGreaterThan(0.85);
      expect(Number.isFinite(vehicle.speed)).toBe(true);
    }
    vehicle.reset(true);
    vehicle.body.setTranslation({ x: -100, y: 2.5, z: -110 }, true);
    vehicle.afterStep(0);
    step(10, { throttle: 1, steer: 1, handbrake: 1 });
    expect(vehicle.groundedWheels).toBe(0);
    expect(vehicle.drift.active).toBe(false);
    step(240);
    expect(vehicle.groundedWheels).toBe(4);
    // Raycast suspension applies impulses before the world gravity step. Validate
    // actual settled height over time, rather than the intermediate linvel value.
    const heights: number[] = [];
    for (let i = 0; i < 60; i++) {
      step(1);
      heights.push(vehicle.position.y);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01);
    expect(vehicle.position.y).toBeGreaterThan(0.4);
    expect(vehicle.position.y).toBeLessThan(0.8);
  } finally {
    world.free();
  }
});

test("short handbrake slides remain recoverable at multiple approach speeds", async () => {
  for (const kmh of [40, 60, 90]) {
    const { world, vehicle, step } = await pad();
    try {
      for (let frame = 0; frame < 600 && vehicle.speed < kmh / 3.6; frame++)
        step(1, { throttle: 1 });
      const entry = vehicle.speed;
      step(18, { throttle: 0.5, steer: 0.7, handbrake: 1 });
      let peak = 0;
      for (let frame = 0; frame < 90; frame++) {
        step(1, {
          throttle: 0.5,
          steer: frame < 18 ? 0.4 : -Math.max(-0.7, Math.min(0.7, vehicle.drift.slipAngle * 1.8)),
        });
        peak = Math.max(peak, Math.abs(vehicle.drift.slipAngle));
        expect(new Vector3(0, 1, 0).applyQuaternion(vehicle.rotation).y).toBeGreaterThan(0.85);
      }
      expect(peak).toBeLessThan(1.2);
      expect(vehicle.speed).toBeGreaterThan(entry * 0.25);
      for (let frame = 0; frame < 240; frame++)
        step(1, { steer: -Math.max(-0.7, Math.min(0.7, vehicle.drift.slipAngle * 1.8)) });
      expect(Math.abs(vehicle.drift.slipAngle)).toBeLessThan(0.13);
      expect(vehicle.drift.rearGrip).toBeGreaterThan(0.99);
      expect(vehicle.groundedWheels).toBe(4);
    } finally {
      world.free();
    }
  }
});
