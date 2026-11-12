import {
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import type { Camera } from "three/webgpu";
import type { VehiclePhysics } from "../vehicle/VehiclePhysics";

const CAPACITY = 96;
const LIFE = 1.45;
/** Fixed particle pool: ground-contact emitters, world-space drift, no per-frame allocation. */
export class TireSmoke {
  readonly root = new Group();
  private readonly mesh: InstancedMesh;
  private readonly ages = new Float32Array(CAPACITY).fill(LIFE);
  private readonly positions = Array.from({ length: CAPACITY }, () => new Vector3());
  private readonly velocities = Array.from({ length: CAPACITY }, () => new Vector3());
  private readonly dummy = new Object3D();
  private readonly contact = new Vector3();
  private cursor = 0;
  private accumulator = 0;
  count = 0;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(220,225,215,0.3)");
    gradient.addColorStop(0.35, "rgba(220,225,215,0.18)");
    gradient.addColorStop(1, "rgba(220,225,215,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    const material = new MeshBasicNodeMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.root.add(this.mesh);
    this.clear();
  }

  update(vehicle: VehiclePhysics, camera: Camera, dt: number): void {
    dt = Math.min(0.05, Math.max(0, dt));
    const active = vehicle.drift.active || (vehicle.handbrake > 0.5 && Math.abs(vehicle.speed) > 6);
    if (active) {
      this.accumulator += dt * 40;
      while (this.accumulator >= 1) {
        this.accumulator--;
        for (let wheel = 2; wheel < 4; wheel++) {
          if (!vehicle.controller.wheelIsInContact(wheel)) continue;
          vehicle.controller.wheelContactPoint(wheel, this.contact);
          const i = this.cursor++ % CAPACITY;
          this.ages[i] = 0;
          this.positions[i].copy(this.contact);
          this.positions[i].y += 0.12;
          this.velocities[i].set(
            Math.sin(i * 2.4) * 0.25,
            0.4 + (i % 5) * 0.04,
            Math.cos(i * 1.8) * 0.25,
          );
        }
      }
    } else this.accumulator = 0;
    this.count = 0;
    for (let i = 0; i < CAPACITY; i++) {
      this.ages[i] += dt;
      const t = this.ages[i] / LIFE;
      if (t < 1) {
        this.count++;
        this.positions[i].addScaledVector(this.velocities[i], dt);
        this.dummy.position.copy(this.positions[i]);
        this.dummy.quaternion.copy(camera.quaternion);
        const size = (0.45 + t * 2.0) * Math.min(1, (1 - t) * 5);
        this.dummy.scale.setScalar(size);
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.ages.fill(LIFE);
    this.accumulator = this.cursor = this.count = 0;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
