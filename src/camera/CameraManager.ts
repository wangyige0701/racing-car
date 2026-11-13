import { PerspectiveCamera, Quaternion, Vector3 } from "three/webgpu";
import type { Group } from "three/webgpu";
import RAPIER from "@dimforge/rapier3d-compat";
import { ChaseCamera } from "./ChaseCamera";

import { CAMERA_MODES, CAMERA_ANCHORS } from "./config";
import type { CameraMode } from "./config";

/** One render camera; transitions use the interpolated chassis, independent of Vue. */
export class CameraManager {
  readonly camera = new PerspectiveCamera(56, 1, 0.04, 1100);
  private readonly chase = new ChaseCamera();
  private readonly target = new PerspectiveCamera();
  private readonly fromPosition = new Vector3();
  private readonly fromRotation = new Quaternion();
  private readonly lastPosition = new Vector3();
  private readonly look = new Vector3();
  private readonly direction = new Vector3();
  private readonly rayOrigin = new Vector3();
  private readonly ray = new RAPIER.Ray(this.rayOrigin, this.direction);
  private progress = 1;
  private initialized = false;
  private portrait = false;
  private index = 0;
  private impact = 0;
  private impactTime = 0;
  kick(strength: number): void {
    this.impact = Math.max(this.impact, strength);
    this.impactTime = 0;
  }
  get mode(): CameraMode {
    return CAMERA_MODES[this.index];
  }

  cycle(): void {
    this.index = (this.index + 1) % CAMERA_MODES.length;
    this.fromPosition.copy(this.camera.position);
    this.fromRotation.copy(this.camera.quaternion);
    this.progress = 0;
  }

  update(car: Group, speed: number, dt: number, world: RAPIER.World, snap = false): void {
    this.chase.update(car, speed, dt, world, snap);
    if (this.mode === "chase") {
      this.target.position.copy(this.chase.camera.position);
      this.target.quaternion.copy(this.chase.camera.quaternion);
    } else {
      const anchor = CAMERA_ANCHORS[this.mode];
      this.target.position.set(anchor.x, anchor.y, anchor.z);
      this.target.position.applyQuaternion(car.quaternion).add(car.position);
      this.look.set(anchor.x, anchor.lookY, 45).applyQuaternion(car.quaternion).add(car.position);
      this.target.up.set(0, 1, 0).applyQuaternion(car.quaternion);
      this.target.lookAt(this.look);
    }
    if (snap || !this.initialized) {
      this.fromPosition.copy(this.target.position);
      this.fromRotation.copy(this.target.quaternion);
      this.progress = 1;
    }
    // Keep the transition origin moving with the car so acceleration cannot leave it behind.
    if (this.initialized) this.fromPosition.add(car.position).sub(this.lastPosition);
    this.progress = Math.min(1, this.progress + Math.max(0, Math.min(dt, 0.1)) / 0.65);
    const blend = this.progress * this.progress * (3 - 2 * this.progress);
    this.camera.position.lerpVectors(this.fromPosition, this.target.position, blend);
    this.camera.quaternion.slerpQuaternions(this.fromRotation, this.target.quaternion, blend);
    if (snap) this.impact = 0;
    this.impactTime += Math.max(0, Math.min(dt, 0.1));
    this.impact *= Math.exp(-10 * Math.max(0, dt));
    this.camera.rotateX(Math.sin(this.impactTime * 40) * this.impact * 0.025);
    // Guard the actual blended camera arm, including transitions between modes.
    this.rayOrigin.copy(car.position).add({ x: 0, y: 0.65, z: 0 });
    this.direction.subVectors(this.camera.position, this.rayOrigin);
    const length = this.direction.length();
    if (length > 0.001) {
      this.direction.divideScalar(length);
      const hit = world.castRay(this.ray, length, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      if (hit)
        this.camera.position
          .copy(this.rayOrigin)
          .addScaledVector(this.direction, Math.max(0, hit.timeOfImpact - 0.16));
    }
    const fov = this.portrait ? 68 : this.mode === "chase" ? 56 : 65;
    this.camera.fov += (fov - this.camera.fov) * (snap ? 1 : 1 - Math.exp(-8 * dt));
    this.camera.updateProjectionMatrix();
    this.lastPosition.copy(car.position);
    this.initialized = true;
  }

  resize(width: number, height: number): void {
    this.portrait = width < height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.chase.resize(width, height);
  }
}
