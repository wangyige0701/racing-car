import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three/webgpu";
import { VEHICLE } from "./config";
import type { DriverInput } from "./config";
import type { Track } from "../track/Track";

export class VehiclePhysics {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly position = new Vector3();
  readonly previousPosition = new Vector3();
  readonly rotation = new Quaternion();
  readonly previousRotation = new Quaternion();
  readonly wheelLengths = [0.32, 0.32, 0.32, 0.32];
  readonly previousWheelLengths = [0.32, 0.32, 0.32, 0.32];
  wheelAngle = 0;
  previousWheelAngle = 0;
  speed = 0;
  throttle = 0;
  brake = 0;
  steer = 0;
  previousSteer = 0;
  rpm = 950;
  gear = 1;
  distance = 0;
  groundedWheels = 0;
  private direction = 1;
  private directionWait = 0;
  private readonly forward = new Vector3();
  private readonly velocity = new Vector3();
  private readonly force = new Vector3();

  constructor(
    world: RAPIER.World,
    private readonly track: Track,
  ) {
    const pose = track.pose();
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pose.position.x, pose.position.y, pose.position.z)
        .setRotation(pose.rotation)
        .setAdditionalMassProperties(VEHICLE.mass, VEHICLE.centerOfMass, VEHICLE.inertia, {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
        })
        .setLinearDamping(0.03)
        .setAngularDamping(0.8)
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.91, 0.23, 2.04)
        .setTranslation(0, 0.12, 0)
        .setDensity(0)
        .setFriction(0.25)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    // This setter is named setIndexForwardAxis in Rapier 0.21's public API.
    this.controller.setIndexForwardAxis = 2;
    VEHICLE.wheelConnections.forEach((p, i) => {
      this.controller.addWheel(
        p,
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        VEHICLE.suspension.rest,
        VEHICLE.wheelRadius,
      );
      this.controller.setWheelSuspensionStiffness(i, VEHICLE.suspension.stiffness);
      this.controller.setWheelSuspensionCompression(i, VEHICLE.suspension.compression);
      this.controller.setWheelSuspensionRelaxation(i, VEHICLE.suspension.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, VEHICLE.suspension.travel);
      this.controller.setWheelMaxSuspensionForce(i, VEHICLE.suspension.maxForce);
      this.controller.setWheelFrictionSlip(i, VEHICLE.tireFriction);
      this.controller.setWheelSideFrictionStiffness(i, VEHICLE.sideFriction);
    });
    this.readPose();
    this.previousPosition.copy(this.position);
    this.previousRotation.copy(this.rotation);
  }

  beforeStep(dt: number, input: DriverInput): void {
    this.previousPosition.copy(this.position);
    this.previousRotation.copy(this.rotation);
    this.previousSteer = this.steer;
    this.previousWheelAngle = this.wheelAngle;
    for (let i = 0; i < 4; i++) this.previousWheelLengths[i] = this.wheelLengths[i];
    const accelerator = Math.max(0, Math.min(1, input.throttle));
    const pedal = Math.max(0, Math.min(1, input.brake));
    const both = accelerator > 0.05 && pedal > 0.05;
    const desired = accelerator > 0.05 ? 1 : pedal > 0.05 ? -1 : 0;
    let drive = 0;
    this.brake = 0;
    if (both) {
      this.brake = Math.max(accelerator, pedal);
      this.directionWait = 0;
    } else if (desired !== 0) {
      if (desired !== this.direction) {
        this.brake = desired === 1 ? accelerator : pedal;
        this.directionWait = Math.abs(this.speed) < 0.6 ? this.directionWait + dt : 0;
        if (this.directionWait >= VEHICLE.directionDelay) {
          this.direction = desired;
          this.directionWait = 0;
          this.brake = 0;
        }
      } else this.directionWait = 0;
      if (desired === this.direction) drive = desired === 1 ? accelerator : pedal;
    } else this.directionWait = 0;
    const targetThrottle = this.brake > 0 ? 0 : drive;
    this.throttle += (targetThrottle - this.throttle) * (1 - Math.exp(-VEHICLE.throttleRate * dt));
    if (this.brake > 0) this.throttle = 0;
    const steerLimit = VEHICLE.maxSteer / (1 + (Math.abs(this.speed) / 15) ** 2);
    const targetSteer = Math.max(-1, Math.min(1, input.steer)) * steerLimit;
    this.steer += (targetSteer - this.steer) * (1 - Math.exp(-VEHICLE.steeringRate * dt));
    const speed = Math.abs(this.speed);
    const gearIndex = VEHICLE.gearSpeeds.reduce<number>(
      (best, threshold, i) => (speed >= threshold ? i : best),
      0,
    );
    this.gear = this.direction === -1 ? -1 : gearIndex + 1;
    const ratio = this.direction === -1 ? 2.8 : VEHICLE.gears[gearIndex];
    this.rpm = Math.max(
      950,
      Math.min(
        7200,
        (speed / (2 * Math.PI * VEHICLE.wheelRadius)) * 60 * ratio * VEHICLE.finalDrive,
      ),
    );
    const torque =
      VEHICLE.maxTorque * (0.68 + 0.32 * Math.sin(Math.min(1, this.rpm / 7400) * Math.PI));
    const speedLimit = this.direction === 1 ? VEHICLE.maxSpeed : VEHICLE.reverseSpeed;
    const taper = Math.max(0, 1 - (speed / speedLimit) ** 4);
    const driveForce =
      ((torque * ratio * VEHICLE.finalDrive * VEHICLE.efficiency) / VEHICLE.wheelRadius) *
      this.throttle *
      taper *
      this.direction;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, i < 2 ? this.steer : 0);
      this.controller.setWheelEngineForce(i, i >= 2 ? driveForce / 2 : 0);
      this.controller.setWheelBrake(i, (this.brake * VEHICLE.maxBrakeForce * dt) / 4);
    }
    this.body.resetForces(false);
    this.body.linvel(this.velocity);
    const velocityMagnitude = this.velocity.length();
    this.force.copy(this.velocity).multiplyScalar(-0.45 * velocityMagnitude);
    if (this.groundedWheels >= 2) this.force.y -= Math.min(3500, speed * speed * 1.8);
    this.body.addForce(this.force, false);
    if (this.throttle > 0.01 || this.brake > 0) this.body.wakeUp();
    this.controller.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
  }

  afterStep(dt: number): void {
    this.readPose();
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    this.body.linvel(this.velocity);
    this.speed = this.velocity.dot(this.forward);
    this.distance += this.position.distanceTo(this.previousPosition);
    this.wheelAngle += (this.speed / VEHICLE.wheelRadius) * dt;
    this.groundedWheels = 0;
    for (let i = 0; i < 4; i++) {
      this.wheelLengths[i] = this.controller.wheelSuspensionLength(i) ?? VEHICLE.suspension.rest;
      if (this.controller.wheelIsInContact(i)) this.groundedWheels++;
    }
  }

  private readPose(): void {
    this.body.translation(this.position);
    this.body.rotation(this.rotation);
  }

  reset(atStart = false): void {
    const pose = this.track.pose(
      atStart ? 10 : this.track.nearest(this.position.x, this.position.z),
    );
    this.body.setTranslation(pose.position, true);
    this.body.setRotation(pose.rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.direction = 1;
    this.directionWait = 0;
    this.speed = this.throttle = this.brake = this.steer = this.previousSteer = this.distance = 0;
    this.wheelAngle = this.previousWheelAngle = 0;
    this.gear = 1;
    this.rpm = 950;
    this.groundedWheels = 0;
    for (let i = 0; i < 4; i++) {
      this.wheelLengths[i] = this.previousWheelLengths[i] = VEHICLE.suspension.rest;
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
    this.readPose();
    this.previousPosition.copy(this.position);
    this.previousRotation.copy(this.rotation);
  }
}
