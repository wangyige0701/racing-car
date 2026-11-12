import { test, expect } from "@playwright/test";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Vector3 } from "three/webgpu";
import { CameraManager } from "../src/camera/CameraManager";
import { CAMERA_ANCHORS, CAMERA_MODES } from "../src/camera/config";

test("four camera modes transition continuously and follow the rotated chassis", async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    const car = new Group();
    car.position.set(8, 1, 12);
    car.rotation.y = 0.8;
    const cameras = new CameraManager();
    cameras.resize(1440, 900);
    cameras.update(car, 0, 1 / 60, world, true);
    for (const mode of [...CAMERA_MODES.slice(1), "chase"]) {
      const before = cameras.camera.position.clone();
      const orientation = cameras.camera.quaternion.clone();
      cameras.cycle();
      expect(cameras.mode).toBe(mode);
      cameras.update(car, 0, 0, world);
      expect(cameras.camera.position.distanceTo(before)).toBeLessThan(1e-6);
      expect(cameras.camera.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
      let previous = before;
      for (let i = 0; i < 60; i++) {
        cameras.update(car, 0, 1 / 60, world);
        expect(cameras.camera.position.distanceTo(previous)).toBeLessThan(0.6);
        previous = cameras.camera.position.clone();
      }
      if (cameras.mode !== "chase") {
        const anchor = CAMERA_ANCHORS[cameras.mode];
        const expected = new Vector3(anchor.x, anchor.y, anchor.z)
          .applyQuaternion(car.quaternion)
          .add(car.position);
        expect(cameras.camera.position.distanceTo(expected)).toBeLessThan(0.001);
        const forward = new Vector3(0, 0, 1).applyQuaternion(car.quaternion);
        expect(cameras.camera.getWorldDirection(new Vector3()).dot(forward)).toBeGreaterThan(0.99);
      }
    }
    cameras.resize(390, 844);
    expect(cameras.camera.aspect).toBeCloseTo(390 / 844);
    cameras.cycle();
    cameras.update(car, 20, 0.1, world);
    cameras.cycle(); // Rapid changes must start at the actual blended pose.
    const intermediate = cameras.camera.position.clone();
    cameras.update(car, 20, 0, world);
    expect(cameras.camera.position.distanceTo(intermediate)).toBeLessThan(1e-6);
    car.position.set(0, 1, 0);
    cameras.update(car, 0, 0, world, true);
    expect(cameras.camera.position.distanceTo(car.position)).toBeLessThan(3);
  } finally {
    world.free();
  }
});

test("chase and blended cameras are kept in front of a solid barrier", async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.cuboid(20, 10, 0.2).setTranslation(0, 0, -3));
    world.step();
    const cameras = new CameraManager();
    const car = new Group();
    car.position.y = 0.6;
    cameras.update(car, 20, 0, world, true);
    expect(cameras.camera.position.z).toBeGreaterThan(-2.8);
    cameras.cycle();
    for (let i = 0; i < 45; i++) {
      cameras.update(car, 20, 1 / 60, world);
      expect(cameras.camera.position.z).toBeGreaterThan(-2.8);
    }
  } finally {
    world.free();
  }
});
