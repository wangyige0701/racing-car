import RAPIER from "@dimforge/rapier3d-compat";
import type { Track } from "../track/Track";
import { Vector3 } from "three/webgpu";

let initialization: Promise<void> | undefined;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events = new RAPIER.EventQueue(true);
  readonly barriers = new Set<number>();
  collisionCount = 0;
  impactId = 0;
  impactStrength = 0;
  impactAge = 10;
  scrape = 0;
  readonly impactPoint = new Vector3();
  readonly impactNormal = new Vector3();
  private readonly velocity = new Vector3();
  private readonly normal = new Vector3();
  private disposed = false;

  static async create(track: Track): Promise<PhysicsWorld> {
    initialization ??= RAPIER.init().catch((error) => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    return new PhysicsWorld(track);
  }

  private constructor(track: Track) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(800, 0.5, 800).setTranslation(0, -0.55, 0).setFriction(0.65),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(track.vertices, track.indices).setFriction(1),
    );
    for (const segment of track.barrierSegments()) {
      const collider = this.world.createCollider(
        // 降低物理包络高度可缩短侧向冲量的力臂，
        // 同时仍覆盖底盘在完整行程中的范围。
        RAPIER.ColliderDesc.roundCuboid(0.3, 0.45, segment.length / 2, 0.1)
          .setTranslation(segment.x, segment.y + 0.45, segment.z)
          .setRotation(segment.rotation)
          .setFriction(0.02)
          .setRestitution(0),
      );
      this.barriers.add(collider.handle);
    }
  }

  step(dt: number): void {
    this.impactAge += dt;
    this.scrape *= Math.exp(-12 * dt);
    this.world.timestep = dt;
    this.world.step(this.events);
    this.events.drainCollisionEvents((a, b, started) => {
      if (started && (this.barriers.has(a) || this.barriers.has(b))) this.collisionCount++;
    });
    let strongest = 0;
    this.events.drainContactForceEvents((event) => {
      const a = event.collider1(),
        b = event.collider2();
      if (!this.barriers.has(a) && !this.barriers.has(b)) return;
      const body = this.world.getCollider(this.barriers.has(a) ? b : a).parent();
      if (!body?.isDynamic()) return;
      event.maxForceDirection(this.normal);
      body.linvel(this.velocity);
      const tangent = Math.sqrt(
        Math.max(0, this.velocity.lengthSq() - this.velocity.dot(this.normal) ** 2),
      );
      const force = event.totalForceMagnitude();
      this.scrape = Math.max(this.scrape, Math.min(1, tangent / 18) * Math.min(1, force / 8000));
      const strength = Math.min(1, (force * dt) / (body.mass() * 12));
      if (strength > strongest && strength > 0.025 && this.impactAge > 0.18) {
        strongest = strength;
        this.impactNormal.copy(this.normal);
        this.impactPoint.copy(body.translation());
        this.world.contactPair(this.world.getCollider(a), this.world.getCollider(b), (manifold) => {
          if (manifold.numSolverContacts()) manifold.solverContactPoint(0, this.impactPoint);
        });
      }
    });
    if (strongest) {
      this.impactId++;
      this.impactStrength = strongest;
      this.impactAge = 0;
    }
  }

  resetFeedback(): void {
    this.collisionCount = this.impactId = this.impactStrength = this.scrape = 0;
    this.impactAge = 10;
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.events.free();
      this.world.free();
    }
  }
}
