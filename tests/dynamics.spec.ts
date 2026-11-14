import { test, expect } from "@playwright/test";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three/webgpu";
import { Track } from "../src/track/Track";
import { VehiclePhysics } from "../src/vehicle/VehiclePhysics";
import { DriftController } from "../src/vehicle/DriftController";
import { emptyInput, VEHICLE, steeringLimit } from "../src/vehicle/config";
import type { DriverInput } from "../src/vehicle/config";

// 开阔平地用于隔离轮胎行为，排除护栏碰撞和赛道曲率的影响。
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

test("松油滑行在三秒内明显减速，低速阻力不使车辆反向", async () => {
  for (const kmh of [60, 100]) {
    const { world, vehicle, step } = await pad();
    try {
      for (let i = 0; i < 900 && vehicle.speed < kmh / 3.6; i++) step(1, { throttle: 1 });
      const entry = vehicle.speed * 3.6;
      step(180);
      const drop = entry - vehicle.speed * 3.6;
      expect(drop).toBeGreaterThan(kmh === 60 ? 15 : 20);
      expect(drop).toBeLessThan(30);
      expect(vehicle.speed).toBeGreaterThan(0);
      step(1800);
      expect(Math.abs(vehicle.speed)).toBeLessThan(0.3);
    } finally {
      world.free();
    }
  }
});

test("低速常速和高速转弯都具有足够曲率且保持车身稳定", async () => {
  for (const kmh of [20, 60, 100]) {
    const { world, vehicle, step } = await pad();
    try {
      const forward = new Vector3(0, 0, kmh / 3.6).applyQuaternion(vehicle.rotation);
      vehicle.body.setLinvel(forward, true);
      vehicle.afterStep(0);
      for (let i = 0; i < 180; i++) {
        step(1, {
          throttle: Math.max(0, Math.min(1, (kmh / 3.6 - vehicle.speed) * 0.5 + 0.12)),
          steer: 0.8,
        });
        expect(new Vector3(0, 1, 0).applyQuaternion(vehicle.rotation).y).toBeGreaterThan(0.85);
      }
      const radius = Math.abs(vehicle.speed / vehicle.body.angvel().y);
      expect(radius).toBeLessThan(kmh === 20 ? 8 : kmh === 60 ? 15.5 : 35);
      expect(vehicle.speed * 3.6).toBeGreaterThan(kmh * 0.9);
      expect(vehicle.drift.control).toBe(0);
    } finally {
      world.free();
    }
  }
});

test("行驶中油门不放大轻刹力度，轻刹比满刹保留更多速度", async () => {
  const speeds: number[] = [];
  for (const brake of [0.2, 1]) {
    const { world, vehicle, step } = await pad();
    try {
      step(180, { throttle: 1 });
      const entry = vehicle.speed;
      step(12, { throttle: 1, brake });
      expect(vehicle.burnout).toBe(false);
      expect(vehicle.brake).toBe(brake);
      expect(vehicle.throttle).toBe(0);
      expect(vehicle.speed).toBeLessThan(entry);
      speeds.push(vehicle.speed);
    } finally {
      world.free();
    }
  }
  expect(speeds[0] - speeds[1]).toBeGreaterThan(2);
});

test("普通紧弯侧滑后首次手刹仍然起漂，再次手刹才恢复抓地", () => {
  const drift = new DriftController();
  drift.measure(1 / 60, 10, 2, 4);
  expect(drift.active).toBe(true);
  drift.updateGrip(1 / 60, 0, 1, -0.4, 10, 0, 4, false, false);
  expect(drift.control).toBe(0);
  drift.updateGrip(1 / 60, 1, 1, -0.4, 10, 0, 4, false, false);
  expect(drift.recovering).toBe(false);
  expect(drift.control).toBeGreaterThan(0);
  expect(drift.rearGrip).toBeLessThan(1);
  drift.updateGrip(1 / 60, 0, 1, -0.4, 10, 0, 4, false, false);
  drift.updateGrip(1 / 60, 1, 1, -0.4, 10, 0, 4, false, false);
  expect(drift.recovering).toBe(true);
});

test("漂移辅助衰减后恢复完整普通转向，不残留三成输入限制", async () => {
  const { world, vehicle, step } = await pad();
  try {
    step(180, { throttle: 1 });
    step(40, { throttle: 0.6, steer: 0.6, handbrake: 1 });
    step(480, { throttle: 0.35 });
    expect(vehicle.drift.control).toBeLessThan(0.01);
    step(60, { throttle: 0.35, steer: 0.35 });
    expect(Math.abs(vehicle.steer) / steeringLimit(vehicle.speed)).toBeGreaterThan(0.3);
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
    // 射线悬挂会在世界重力步进前施加冲量。应验证随时间收敛后的实际高度，
    // 而非中间的线速度值。
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
