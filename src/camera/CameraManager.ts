import { PerspectiveCamera, Quaternion, Vector3 } from "three/webgpu";
import type { Group } from "three/webgpu";
import RAPIER from "@dimforge/rapier3d-compat";
import { ChaseCamera } from "./ChaseCamera";

import { CAMERA_MODES, CAMERA_ANCHORS } from "./config";
import type { CameraMode } from "./config";
import { DEFAULT_CAMERA_SETTINGS, type CameraSettings } from "./config";

/** 只使用一个渲染相机；过渡基于插值后的底盘，与 Vue 无关。 */
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
  readonly settings = { ...DEFAULT_CAMERA_SETTINGS };
  lookDirection = 0;
  private headYaw = 0;
  private headZ = 0;
  private steer = 0;
  private acceleration = 0;
  setSettings(settings: CameraSettings): void {
    this.settings.fov = Math.max(55, Math.min(80, Number(settings.fov) || 65));
    this.settings.height = Math.max(-0.04, Math.min(0.08, Number(settings.height) || 0));
    this.settings.back = Math.max(-0.08, Math.min(0.06, Number(settings.back) || 0));
    this.settings.motion = settings.motion;
  }
  setMotion(steer: number, acceleration: number): void {
    this.steer = steer;
    this.acceleration = acceleration;
  }
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
    this.setMode(CAMERA_MODES[(this.index + 1) % CAMERA_MODES.length]);
  }

  setMode(mode: CameraMode): void {
    const index = CAMERA_MODES.indexOf(mode);
    if (index < 0 || index === this.index) return;
    this.index = index;
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
      if (this.mode === "cockpit") {
        const blend = snap ? 1 : 1 - Math.exp(-6 * Math.min(0.1, Math.max(0, dt)));
        const turn =
          this.settings.motion && speed > 4
            ? Math.max(-0.07, Math.min(0.07, this.steer * 0.45))
            : 0;
        this.headYaw += (this.lookDirection * 0.85 + turn - this.headYaw) * blend;
        this.headZ +=
          ((this.settings.motion
            ? Math.max(-0.025, Math.min(0.025, -this.acceleration * 0.002))
            : 0) -
            this.headZ) *
          blend;
        if (snap) this.headZ = this.headYaw = 0;
        this.target.position.y += this.settings.height;
        this.target.position.z = Math.max(
          anchor.z - 0.09,
          Math.min(anchor.z + 0.105, this.target.position.z + this.headZ - this.settings.back),
        );
      }
      this.target.position.applyQuaternion(car.quaternion).add(car.position);
      this.look.set(anchor.x, anchor.lookY, 45).applyQuaternion(car.quaternion).add(car.position);
      this.target.up.set(0, 1, 0).applyQuaternion(car.quaternion);
      this.target.lookAt(this.look);
      if (this.mode === "cockpit") this.target.rotateY(this.headYaw);
    }
    if (snap || !this.initialized) {
      this.fromPosition.copy(this.target.position);
      this.fromRotation.copy(this.target.quaternion);
      this.progress = 1;
    }
    // 让过渡起点随车辆移动，避免加速时镜头起点滞后。
    if (this.initialized) this.fromPosition.add(car.position).sub(this.lastPosition);
    this.progress = Math.min(1, this.progress + Math.max(0, Math.min(dt, 0.1)) / 0.65);
    const blend = this.progress * this.progress * (3 - 2 * this.progress);
    this.camera.position.lerpVectors(this.fromPosition, this.target.position, blend);
    this.camera.quaternion.slerpQuaternions(this.fromRotation, this.target.quaternion, blend);
    if (snap) this.impact = 0;
    this.impactTime += Math.max(0, Math.min(dt, 0.1));
    this.impact *= Math.exp(-10 * Math.max(0, dt));
    if (this.settings.motion)
      this.camera.rotateX(Math.sin(this.impactTime * 40) * this.impact * 0.025);
    // 保护实际混合后的相机臂，覆盖视角模式之间的过渡。
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
    const fov =
      this.mode === "cockpit"
        ? this.settings.fov
        : this.portrait
          ? 68
          : this.mode === "chase"
            ? 56
            : 65;
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
