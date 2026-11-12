import { test, expect } from "@playwright/test";
import { FixedStep } from "../src/core/FixedStep";
import { PhysicsWorld } from "../src/physics/PhysicsWorld";

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

test("Rapier gravity, collision, settling and reset operate on a dynamic body", async () => {
  const physics = await PhysicsWorld.create();
  try {
    expect(physics.body.isDynamic()).toBe(true);
    for (let step = 0; step < 20; step++) physics.step(1 / 60);
    expect(physics.height).toBeLessThan(3.6);
    expect(physics.height).toBeGreaterThan(3);
    let lowest = physics.height;
    let bounced = false;
    for (let step = 0; step < 700; step++) {
      physics.step(1 / 60);
      lowest = Math.min(lowest, physics.height);
      if (physics.body.linvel().y > 1) bounced = true;
    }
    expect(lowest).toBeGreaterThan(0.84);
    expect(bounced).toBe(true);
    expect(physics.height).toBeCloseTo(0.9, 1);
    physics.reset();
    expect(physics.height).toBe(4);
    expect(physics.interpolatedHeight(0.5)).toBe(4);
    expect(physics.body.linvel().y).toBe(0);
    physics.step(1 / 60);
    expect(physics.height).toBeLessThan(4);
  } finally {
    physics.dispose();
  }
});
