import RAPIER from "@dimforge/rapier3d-compat";

let initialization: Promise<void> | undefined;

/** Rapier owns all physical state. Rendering only reads the previous/current poses. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  previousHeight = 4;
  height = 4;
  private disposed = false;

  static async create(): Promise<PhysicsWorld> {
    initialization ??= RAPIER.init().catch((error) => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Calibration pad top is y = 0.25; the visible sphere radius is 0.65 m.
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.125, 3.8).setTranslation(0, 0.125, 0));
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 4, 0).setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(0.65).setMass(35).setRestitution(0.55).setFriction(0.8),
      this.body,
    );
  }

  step(dt: number): void {
    this.previousHeight = this.height;
    this.world.timestep = dt;
    this.world.step();
    this.height = this.body.translation().y;
  }

  interpolatedHeight(alpha: number): number {
    return this.previousHeight + (this.height - this.previousHeight) * alpha;
  }

  reset(): void {
    // Teleporting is allowed only for explicit reset, never for movement simulation.
    this.body.setTranslation({ x: 0, y: 4, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.previousHeight = this.height = 4;
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.world.free();
    }
  }
}
