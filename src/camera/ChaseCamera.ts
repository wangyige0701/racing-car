import { PerspectiveCamera, Vector3 } from "three/webgpu";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Group } from "three/webgpu";

export class ChaseCamera {
  readonly camera = new PerspectiveCamera(56, 1, 0.1, 1100);
  private readonly forward = new Vector3();
  private readonly desired = new Vector3();
  private readonly target = new Vector3();
  private readonly look = new Vector3();
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly ray = new RAPIER.Ray(this.rayOrigin, this.rayDirection);
  private initialized = false;

  update(car: Group, speed: number, dt: number, world: RAPIER.World, snap = false): void {
    this.forward.set(0, 0, 1).applyQuaternion(car.quaternion);
    this.forward.y = 0;
    this.forward.normalize();
    this.desired
      .copy(car.position)
      .addScaledVector(this.forward, -7.6 - Math.min(Math.abs(speed) * 0.065, 2.5));
    this.desired.y += 3.5;
    this.target
      .copy(car.position)
      .addScaledVector(this.forward, 3 + Math.min(Math.abs(speed) * 0.08, 3));
    this.target.y += 0.7;
    const blend = snap || !this.initialized ? 1 : 1 - Math.exp(-7 * Math.min(dt, 0.1));
    this.camera.position.lerp(this.desired, blend);
    this.look.lerp(this.target, blend);
    // Clip the follow arm against actual colliders, excluding the dynamic chassis.
    this.rayOrigin.copy(car.position);
    this.rayOrigin.y += 1.0;
    this.rayDirection.subVectors(this.camera.position, this.rayOrigin);
    const distance = this.rayDirection.length();
    this.rayDirection.normalize();
    const hit = world.castRay(this.ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    if (hit)
      this.camera.position
        .copy(this.rayOrigin)
        .addScaledVector(this.rayDirection, Math.max(0.4, hit.timeOfImpact - 0.3));
    this.camera.position.y = Math.max(1.0, this.camera.position.y);
    this.camera.lookAt(this.look);
    this.initialized = true;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 1 ? 68 : 56;
    this.camera.updateProjectionMatrix();
  }
}
