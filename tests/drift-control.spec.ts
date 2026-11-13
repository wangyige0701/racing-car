import { test, expect } from "@playwright/test";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three/webgpu";
import { Track } from "../src/track/Track";
import { VehiclePhysics } from "../src/vehicle/VehiclePhysics";
import { emptyInput, type DriverInput } from "../src/vehicle/config";

async function setup(kmh = 80) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0));
  const vehicle = new VehiclePhysics(world, new Track());
  const step = (frames: number, input: Partial<DriverInput> = {}) => {
    for (let i = 0; i < frames; i++) {
      vehicle.beforeStep(1 / 60, { ...emptyInput(), ...input });
      world.timestep = 1 / 60;
      world.step();
      vehicle.afterStep(1 / 60);
    }
  };
  step(120);
  for (let i = 0; i < 600 && vehicle.speed < kmh / 3.6; i++) step(1, { throttle: 1 });
  step(35, { throttle: 0.7, steer: 0.75, handbrake: 1 });
  return { world, vehicle, step };
}

test("drift steering preserves forward travel and changes the path in both directions", async () => {
  const offsets: number[] = [];
  for (const steer of [-0.55, 0, 0.55]) {
    const { world, vehicle, step } = await setup();
    try {
      const start = vehicle.position.clone();
      const forward = new Vector3(0, 0, 1).applyQuaternion(vehicle.rotation);
      const left = new Vector3(1, 0, 0).applyQuaternion(vehicle.rotation);
      let peak = 0;
      for (let i = 0; i < 180; i++) {
        step(1, { throttle: 0.65, steer });
        peak = Math.max(peak, Math.abs(vehicle.drift.slipAngle));
        expect(vehicle.groundedWheels).toBe(4);
      }
      const travel = vehicle.position.clone().sub(start);
      offsets.push(travel.dot(left));
      expect(travel.dot(forward)).toBeGreaterThan(15);
      expect(vehicle.speed).toBeGreaterThan(10);
      expect(peak).toBeLessThan(0.7);
      if (steer === 0.55) {
        expect(vehicle.drift.duration).toBeGreaterThan(3);
        expect(vehicle.drift.slipAngle).toBeGreaterThan(0.17);
        expect(vehicle.drift.slipAngle).toBeLessThan(0.5);
      }
    } finally {
      world.free();
    }
  }
  expect(offsets[0] - offsets[1]).toBeGreaterThan(8);
  expect(offsets[1] - offsets[2]).toBeGreaterThan(20);
});

test("a second handbrake press or service brake recovers grip without a spin or reverse", async () => {
  for (const control of ["handbrake", "brake"] as const) {
    for (const kmh of [40, 60, 90]) {
      const { world, vehicle, step } = await setup(kmh);
      try {
        step(60, { throttle: 0.8, steer: 0.6 });
        const before = vehicle.drift.rearGrip;
        step(1, { [control]: 1 });
        expect(vehicle.drift.recovering).toBe(true);
        expect(vehicle.drift.rearGrip).toBeGreaterThan(before);
        expect(vehicle.drift.effectiveHandbrake).toBe(0);
        step(36, { [control]: 1 });
        step(120, { throttle: 0.5 });
        expect(vehicle.drift.rearGrip).toBeGreaterThan(0.99);
        expect(Math.abs(vehicle.drift.slipAngle)).toBeLessThan(0.12);
        expect(vehicle.speed).toBeGreaterThan(2);
        expect(vehicle.gear).toBeGreaterThan(0);
        expect(vehicle.groundedWheels).toBe(4);
        vehicle.reset(true);
        expect(vehicle.drift.recovering).toBe(false);
        expect(vehicle.drift.control).toBe(0);
      } finally {
        world.free();
      }
    }
  }
});

test("sustained left-right drift transitions keep the chassis upright and moving", async () => {
  const { world, vehicle, step } = await setup(90);
  try {
    const slips: number[] = [];
    for (const steer of [0.55, -0.55, 0.55]) {
      for (let i = 0; i < 150; i++) {
        step(1, { throttle: 0.85, steer });
        expect(vehicle.speed).toBeGreaterThan(6);
        expect(Math.abs(vehicle.drift.slipAngle)).toBeLessThan(0.8);
        expect(new Vector3(0, 1, 0).applyQuaternion(vehicle.rotation).y).toBeGreaterThan(0.9);
      }
      slips.push(vehicle.drift.slipAngle);
    }
    expect(slips[0]).toBeGreaterThan(0.15);
    expect(slips[1]).toBeLessThan(-0.15);
    expect(slips[2]).toBeGreaterThan(0.15);
  } finally {
    world.free();
  }
});
