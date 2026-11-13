import { InstancedMesh, BoxGeometry, MeshBasicNodeMaterial, Object3D, Vector3 } from "three/webgpu";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

/** Short, bounded world-space bursts at actual barrier contact points. */
export class ContactSparks {
  readonly root = new InstancedMesh(
    new BoxGeometry(0.025, 0.025, 0.11),
    new MeshBasicNodeMaterial({ color: "#ffcb6c", toneMapped: false }),
    32,
  );
  private lastImpact = 0;
  private cursor = 0;
  private readonly life = new Float32Array(32);
  private readonly positions = Array.from({ length: 32 }, () => new Vector3());
  private readonly velocities = Array.from({ length: 32 }, () => new Vector3());
  private readonly dummy = new Object3D();
  constructor() {
    this.root.frustumCulled = false;
    this.clear();
  }
  clear(): void {
    this.life.fill(0);
    this.lastImpact = 0;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 32; i++) this.root.setMatrixAt(i, this.dummy.matrix);
    this.root.instanceMatrix.needsUpdate = true;
  }
  update(physics: PhysicsWorld, dt: number): void {
    dt = Math.max(0, Math.min(0.05, dt));
    if (physics.impactId !== this.lastImpact) {
      this.lastImpact = physics.impactId;
      if (physics.impactStrength > 0.12)
        for (let n = 0; n < 4 + Math.floor(physics.impactStrength * 12); n++) {
          const i = this.cursor++ % 32;
          this.life[i] = 0.2 + (i % 4) * 0.07;
          this.positions[i].copy(physics.impactPoint);
          this.velocities[i].set(Math.sin(i * 7) * 3, 1 + (i % 3), Math.cos(i * 7) * 3);
        }
    }
    for (let i = 0; i < 32; i++) {
      this.life[i] -= dt;
      if (this.life[i] > 0) {
        this.velocities[i].y -= 8 * dt;
        this.positions[i].addScaledVector(this.velocities[i], dt);
        this.dummy.position.copy(this.positions[i]);
        this.dummy.scale.setScalar(Math.min(1, this.life[i] * 10));
        this.dummy.rotation.set(i, i * 2, i * 3);
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.root.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.instanceMatrix.needsUpdate = true;
  }
}
