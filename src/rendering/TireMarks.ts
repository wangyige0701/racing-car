import {
  InstancedMesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Object3D,
  Vector3,
  Matrix4,
} from "three/webgpu";
import type { VehiclePhysics } from "../vehicle/VehiclePhysics";

export class TireMarks {
  readonly root = new InstancedMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicNodeMaterial({
      color: "#141715",
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    }),
    256,
  );
  private readonly previous = [new Vector3(), new Vector3()];
  private connected = [false, false];
  private cursor = 0;
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private readonly direction = new Vector3();
  private readonly right = new Vector3();
  private readonly basis = new Matrix4();
  private readonly dummy = new Object3D();
  constructor() {
    this.root.frustumCulled = false;
    this.clear();
  }
  clear(): void {
    this.cursor = 0;
    this.connected.fill(false);
    this.root.count = 0;
  }
  update(vehicle: VehiclePhysics): void {
    for (let j = 0; j < 2; j++) {
      const wheel = j + 2;
      if (
        !(vehicle.drift.active || vehicle.handbrake > 0.5) ||
        Math.abs(vehicle.speed) < 3 ||
        !vehicle.controller.wheelIsInContact(wheel)
      ) {
        this.connected[j] = false;
        continue;
      }
      vehicle.controller.wheelContactPoint(wheel, this.point);
      vehicle.controller.wheelContactNormal(wheel, this.normal);
      if (this.connected[j]) {
        this.direction.subVectors(this.point, this.previous[j]);
        const distance = this.direction.length();
        if (distance < 0.18) continue;
        if (distance < 2.5) {
          this.direction.normalize();
          this.right.crossVectors(this.direction, this.normal).normalize();
          this.direction.crossVectors(this.normal, this.right).normalize();
          this.basis.makeBasis(this.right, this.direction, this.normal);
          this.dummy.quaternion.setFromRotationMatrix(this.basis);
          this.dummy.position
            .copy(this.point)
            .add(this.previous[j])
            .multiplyScalar(0.5)
            .addScaledVector(this.normal, 0.018);
          this.dummy.scale.set(0.24, distance + 0.04, 1);
          this.dummy.updateMatrix();
          this.root.setMatrixAt(this.cursor++ % 256, this.dummy.matrix);
          this.root.count = Math.min(256, this.cursor);
          this.root.instanceMatrix.needsUpdate = true;
        }
      }
      this.previous[j].copy(this.point);
      this.connected[j] = true;
    }
  }
}
