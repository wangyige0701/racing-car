import RAPIER from "@dimforge/rapier3d-compat";
import type { Track } from "../track/Track";

let initialization: Promise<void> | undefined;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events = new RAPIER.EventQueue(true);
  readonly barriers = new Set<number>();
  collisionCount = 0;
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
        RAPIER.ColliderDesc.cuboid(0.23, 0.65, segment.length / 2)
          .setTranslation(segment.x, 0.65, segment.z)
          .setRotation({ x: 0, y: Math.sin(segment.yaw / 2), z: 0, w: Math.cos(segment.yaw / 2) })
          .setFriction(0.15)
          .setRestitution(0.08),
      );
      this.barriers.add(collider.handle);
    }
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
    this.events.drainCollisionEvents((a, b, started) => {
      if (started && (this.barriers.has(a) || this.barriers.has(b))) this.collisionCount++;
    });
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.events.free();
      this.world.free();
    }
  }
}
