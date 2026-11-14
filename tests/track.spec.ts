import { test, expect } from "@playwright/test";
import { Vector3, Mesh, MeshBasicMaterial, Raycaster } from "three/webgpu";
import { terrainGeometry } from "../src/rendering/Environment";
import { projectTrackMap, trackMapHeading, Track } from "../src/track/Track";
import { TRACKS } from "../src/track/catalog";
import { LapTimer } from "../src/track/LapTimer";
import { PhysicsWorld } from "../src/physics/PhysicsWorld";
import { VehiclePhysics } from "../src/vehicle/VehiclePhysics";
import { emptyInput, VEHICLE } from "../src/vehicle/config";

function cross(timer: LapTimer, track: Track, gate: number, reverse = false, grounded = 4) {
  const s = track.samples[timer.gates[gate]];
  const a = new Vector3(s.x - s.tx, s.y + 0.6 - s.ty, s.z - s.tz);
  const b = new Vector3(s.x + s.tx, s.y + 0.6 + s.ty, s.z + s.tz);
  timer.update(reverse ? b : a, reverse ? a : b, 1 / 60, grounded);
}

test("map projection keeps the marker's SVG heading aligned with vehicle travel", () => {
  expect(projectTrackMap(12, -34)).toEqual({ x: -12, y: 34 });
  // 标记路径朝向局部 -Y，SVG 的正旋转方向为顺时针。
  expect(trackMapHeading(0, 1)).toBe(0);
  expect(trackMapHeading(1, 0)).toBe(270);
  expect(trackMapHeading(0, -1)).toBe(180);
  expect(trackMapHeading(-1, 0)).toBe(90);
});

test("lap timing requires ordered forward grounded gates and rejects reset or off-road laps", () => {
  const track = new Track();
  const timer = new LapTimer(track);
  cross(timer, track, 0, true);
  cross(timer, track, 0, false, 0);
  expect(timer.started).toBe(false);
  cross(timer, track, 0);
  expect(timer.started).toBe(true);
  expect(timer.current).toBeCloseTo(1 / 120);
  cross(timer, track, 2);
  cross(timer, track, 0);
  expect(timer.next).toBe(1);
  expect(timer.laps).toBe(0);
  for (let i = 1; i < 8; i++) cross(timer, track, i);
  cross(timer, track, 0);
  expect(timer.laps).toBe(1);
  expect(timer.best).toBe(timer.last);
  const best = timer.best;
  timer.invalidate();
  cross(timer, track, 7);
  expect(timer.laps).toBe(1);
  expect(timer.started).toBe(false);
  expect(timer.best).toBe(best);
  cross(timer, track, 0);
  const s = track.samples[timer.gates[1]];
  const offroad = new Vector3(s.x + s.tz * 12, s.y + 0.6, s.z - s.tx * 12);
  timer.update(offroad, offroad, 1 / 60, 4);
  expect(timer.valid).toBe(false);
  for (let i = 1; i < 8; i++) cross(timer, track, i);
  cross(timer, track, 0);
  expect(timer.laps).toBe(1);
  expect(timer.valid).toBe(true);
  const gate = track.samples[timer.gates[1]];
  timer.update(
    new Vector3(gate.x - gate.tx * 20, gate.y + 0.6, gate.z - gate.tz * 20),
    new Vector3(gate.x + gate.tx * 20, gate.y + 0.6, gate.z + gate.tz * 20),
    1 / 60,
    4,
  );
  expect(timer.valid).toBe(false);
  expect(timer.next).toBe(1);
  for (let i = 0; i < 60; i++) cross(timer, track, 1, true);
  expect(timer.wrongWay).toBe(true);
});

for (const definition of TRACKS) {
  test(`${definition.id}: rendered terrain stays below the road across the full route`, () => {
    const track = new Track(definition.id);
    const geometry = terrainGeometry(track);
    const material = new MeshBasicMaterial();
    const terrain = new Mesh(geometry, material);
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    try {
      for (const s of track.samples) {
        for (const offset of [-track.width / 2, 0, track.width / 2]) {
          ray.ray.origin.set(s.x + s.tz * offset, 150, s.z - s.tx * offset);
          const hit = ray.intersectObject(terrain)[0];
          expect(hit).toBeDefined();
          expect(hit.point.y).toBeLessThan(s.y - 0.01);
        }
      }
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
  test(`${definition.id}: shared geometry is closed and a physical driver completes a valid lap`, async () => {
    const track = new Track(definition.id);
    expect(track.length).toBeGreaterThan(definition.id === "practice" ? 900 : 3000);
    expect(track.length).toBeLessThan(5000);
    expect(Array.from(track.vertices).every(Number.isFinite)).toBe(true);
    expect(Math.max(...track.samples.map((s) => Math.abs(s.ty)))).toBeLessThan(0.15);
    expect(Array.from(track.indices.slice(-6))).toContain(0);
    // 蜿蜒路线相距较远的路段不得重叠或共用护栏。
    let reversals = 0,
      lastSign = 0,
      clearance = Infinity;
    for (let i = 0; i < track.samples.length; i++) {
      const a = track.samples[i],
        b = track.samples[(i + 1) % track.samples.length];
      const turn = a.tx * b.tz - a.tz * b.tx;
      if (Math.abs(turn) > 0.003) {
        const sign = Math.sign(turn);
        if (lastSign && sign !== lastSign) reversals++;
        lastSign = sign;
      }
      for (let j = i + 1; j < track.samples.length; j++) {
        const gap =
          (Math.min(j - i, track.samples.length - j + i) * track.length) / track.samples.length;
        if (gap < 60) continue;
        const other = track.samples[j];
        clearance = Math.min(clearance, Math.hypot(a.x - other.x, a.z - other.z));
      }
    }
    expect(reversals).toBeGreaterThanOrEqual(4);
    expect(clearance).toBeGreaterThan(track.width + 5);
    const physics = await PhysicsWorld.create(track);
    const vehicle = new VehiclePhysics(physics.world, track);
    const timer = new LapTimer(track);
    const input = emptyInput();
    let maxOffset = 0;
    try {
      for (let frame = 0; frame < 22000 && timer.laps === 0; frame++) {
        const nearest = track.nearest(vehicle.position.x, vehicle.position.z);
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
        input.steer = -Math.max(-1, Math.min(1, angle / limit));
        // 预判急弯；蜿蜒赛道需要在入弯前减速。
        let curvature = 0;
        for (let j = 0; j < lookahead * 2; j++) {
          const a = track.samples[(nearest + j) % track.samples.length];
          const b = track.samples[(nearest + j + 1) % track.samples.length];
          const bend = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
          curvature = Math.max(curvature, bend / (track.length / track.samples.length));
        }
        const targetSpeed = Math.min(23, Math.sqrt(5 / Math.max(0.002, curvature)));
        input.throttle = Math.max(0, Math.min(1, (targetSpeed - vehicle.speed) * 0.4));
        input.brake = vehicle.speed > targetSpeed + 1 ? 0.25 : 0;
        vehicle.beforeStep(1 / 60, input);
        physics.step(1 / 60);
        vehicle.afterStep(1 / 60);
        timer.update(vehicle.previousPosition, vehicle.position, 1 / 60, vehicle.groundedWheels);
        const s = track.samples[nearest];
        maxOffset = Math.max(
          maxOffset,
          Math.abs((vehicle.position.x - s.x) * s.tz - (vehicle.position.z - s.z) * s.tx),
        );
      }
      console.log(
        `${definition.id}: length=${track.length.toFixed(0)}m lap=${timer.last.toFixed(2)}s offset=${maxOffset.toFixed(2)}m`,
      );
      expect(timer.laps).toBe(1);
      expect(timer.last).toBeGreaterThan(track.length / 25);
      expect(timer.last).toBeLessThan(track.length / 10);
      expect(maxOffset).toBeLessThan(track.width / 2 - 1);
      expect(physics.collisionCount).toBe(0);
      vehicle.reset();
      for (let i = 0; i < 120; i++) {
        vehicle.beforeStep(1 / 60, emptyInput());
        physics.step(1 / 60);
        vehicle.afterStep(1 / 60);
      }
      expect(vehicle.groundedWheels).toBe(4);
    } finally {
      physics.dispose();
    }
  });
}
