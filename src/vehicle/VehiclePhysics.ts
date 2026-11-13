import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three/webgpu";
import { VEHICLE } from "./config";
import { DriftController } from "./DriftController";
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
  speed = 0;
  acceleration = 0;
  throttle = 0;
  brake = 0;
  steer = 0;
  previousSteer = 0;
  rpm = 950;
  gear = 1;
  distance = 0;
  groundedWheels = 0;
  handbrake = 0;
  readonly drift = new DriftController();
  readonly wheelAngles = [0, 0, 0, 0];
  readonly previousWheelAngles = [0, 0, 0, 0];
  private direction = 1;
  private directionWait = 0;
  private driveCoupling = 1;
  private readonly forward = new Vector3();
  private readonly velocity = new Vector3();
  private readonly force = new Vector3();
  private readonly lateralAxis = new Vector3();
  private readonly up = new Vector3();
  private readonly contact = new Vector3();
  private readonly angularVelocity = new Vector3();

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
      RAPIER.ColliderDesc.roundCuboid(0.79, 0.11, 1.92, 0.12)
        .setTranslation(0, 0.12, 0)
        .setDensity(0)
        .setFriction(0.25)
        .setRestitution(0.05)
        .setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS,
        )
        .setContactForceEventThreshold(200),
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
    for (let i = 0; i < 4; i++) this.previousWheelAngles[i] = this.wheelAngles[i];
    for (let i = 0; i < 4; i++) this.previousWheelLengths[i] = this.wheelLengths[i];
    const accelerator = Math.max(0, Math.min(1, input.throttle));
    const pedal = Math.max(0, Math.min(1, input.brake));
    this.handbrake = Math.max(0, Math.min(1, input.handbrake));
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
        // A sideways-moving car may have almost zero forward speed while still
        // travelling quickly. Only permit a direction change after it truly stops.
        this.directionWait = this.velocity.length() < 0.6 ? this.directionWait + dt : 0;
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
    this.drift.updateGrip(
      dt,
      this.handbrake,
      this.throttle,
      this.steer,
      this.speed,
      this.brake,
      this.groundedWheels,
    );
    const handbrake = this.drift.effectiveHandbrake;
    const countersteer =
      this.groundedWheels >= 3 &&
      this.speed > VEHICLE.drift.minSpeed &&
      -input.steer * this.drift.slipAngle > 0;
    const slide = Math.min(1, Math.abs(this.drift.slipAngle) / 0.4);
    const steerLimit = Math.min(
      VEHICLE.maxSteer,
      (VEHICLE.maxSteer / (1 + (Math.abs(this.speed) / 15) ** 2)) *
        (1 + (countersteer ? VEHICLE.countersteerReserve * slide : 0)),
    );
    // Align the front tires with the actual contact velocity during a slide,
    // leaving driver steering as an offset that still changes the travel path.
    const targetSteer = Math.max(
      -VEHICLE.maxSteer,
      Math.min(
        VEHICLE.maxSteer,
        -Math.max(-1, Math.min(1, input.steer)) * steerLimit * (1 - this.drift.control * 0.7) +
          this.drift.slipAngle * this.drift.control * VEHICLE.drift.countersteerAssist,
      ),
    );
    this.steer +=
      (targetSteer - this.steer) *
      (1 - Math.exp(-(countersteer ? VEHICLE.countersteerRate : VEHICLE.steeringRate) * dt));
    const speed = Math.abs(this.speed);
    // Handbrake cuts drive immediately; clutch-like recovery prevents a torque step on release.
    this.driveCoupling = Math.min(
      1 - handbrake,
      this.driveCoupling +
        (1 - this.driveCoupling) * (1 - Math.exp(-VEHICLE.driveRecoveryRate * dt)),
    );
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
      const rear = i >= 2;
      const grip = rear ? this.drift.rearGrip : 1;
      this.controller.setWheelFrictionSlip(i, VEHICLE.tireFriction * grip);
      this.controller.setWheelSideFrictionStiffness(i, VEHICLE.sideFriction * grip);
      this.controller.setWheelEngineForce(i, rear ? (driveForce * this.driveCoupling) / 2 : 0);
      this.controller.setWheelBrake(
        i,
        dt *
          ((this.brake * VEHICLE.maxBrakeForce) / 4 +
            (rear ? (handbrake * VEHICLE.handbrakeForce) / 2 : 0) +
            (this.drift.recovering ? this.handbrake * VEHICLE.maxBrakeForce * 0.12 : 0)),
      );
    }
    this.body.resetForces(false);
    this.body.resetTorques(false);
    this.body.linvel(this.velocity);
    const velocityMagnitude = this.velocity.length();
    this.force.copy(this.velocity).multiplyScalar(-0.45 * velocityMagnitude);
    if (this.groundedWheels >= 2) this.force.y -= Math.min(3500, speed * speed * 1.8);
    this.body.addForce(this.force, false);
    if (this.throttle > 0.01 || this.brake > 0 || this.handbrake > 0) this.body.wakeUp();
    this.controller.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    // Equal and opposite forces couple each axle's suspension without adding lift.
    // No stabilizing forces are applied to an airborne axle.
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) contacts++;
    if (contacts >= 3 && speed > VEHICLE.drift.minSpeed) {
      this.body.angvel(this.angularVelocity);
      const yawRate = this.angularVelocity.dot(this.up);
      const control = this.speed > VEHICLE.drift.minSpeed ? this.drift.control : 0;
      const targetSlip = this.drift.recovering
        ? 0
        : input.steer * VEHICLE.drift.targetSlip * (0.5 + this.throttle * 0.5) +
          handbrake * input.steer * 0.25;
      const requestedYaw = -input.steer * Math.min(0.65, 9 / Math.max(8, speed));
      const targetYaw =
        requestedYaw + (this.drift.slipAngle - targetSlip) * VEHICLE.drift.slipRecovery;
      const correction = Math.max(
        -VEHICLE.drift.maxAssistTorque,
        Math.min(
          VEHICLE.drift.maxAssistTorque,
          (targetYaw - yawRate) * VEHICLE.inertia.y * VEHICLE.drift.yawResponse,
        ),
      );
      this.force
        .copy(this.up)
        .multiplyScalar(
          correction * control -
            yawRate *
              VEHICLE.inertia.y *
              VEHICLE.groundYawDamping *
              (1 - control) *
              (0.35 +
                (0.65 * (this.drift.rearGrip - VEHICLE.drift.rearGripMinimum)) /
                  (1 - VEHICLE.drift.rearGripMinimum)),
        );
      this.body.addTorque(this.force, false);
    }
    for (let left = 0; left < 4; left += 2) {
      const right = left + 1;
      if (!this.controller.wheelIsInContact(left) || !this.controller.wheelIsInContact(right))
        continue;
      const difference =
        (this.controller.wheelSuspensionLength(right) ?? 0) -
        (this.controller.wheelSuspensionLength(left) ?? 0);
      const amount = Math.max(
        -VEHICLE.suspension.antiRollMaxForce,
        Math.min(
          VEHICLE.suspension.antiRollMaxForce,
          difference * VEHICLE.suspension.antiRollStiffness,
        ),
      );
      this.controller.wheelHardPoint(left, this.contact);
      this.force.copy(this.up).multiplyScalar(amount);
      this.body.addForceAtPoint(this.force, this.contact, false);
      this.controller.wheelHardPoint(right, this.contact);
      this.force.negate();
      this.body.addForceAtPoint(this.force, this.contact, false);
    }
  }

  afterStep(dt: number): void {
    this.readPose();
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    this.body.linvel(this.velocity);
    const nextSpeed = this.velocity.dot(this.forward);
    if (dt > 0)
      this.acceleration +=
        (Math.max(-20, Math.min(20, (nextSpeed - this.speed) / dt)) - this.acceleration) *
        (1 - Math.exp(-8 * dt));
    this.speed = nextSpeed;
    this.distance += this.position.distanceTo(this.previousPosition);
    this.groundedWheels = 0;
    for (let i = 0; i < 4; i++) {
      this.wheelLengths[i] = this.controller.wheelSuspensionLength(i) ?? VEHICLE.suspension.rest;
      if (this.controller.wheelIsInContact(i)) this.groundedWheels++;
      // Rear wheels slow to a lock under the handbrake; suspension remains independent.
      this.wheelAngles[i] +=
        (this.speed / VEHICLE.wheelRadius) * dt * (i >= 2 ? 1 - this.drift.effectiveHandbrake : 1);
    }
    this.lateralAxis.set(1, 0, 0).applyQuaternion(this.rotation);
    this.drift.measure(dt, this.speed, this.velocity.dot(this.lateralAxis), this.groundedWheels);
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
    this.driveCoupling = 1;
    this.acceleration = 0;
    this.speed = this.throttle = this.brake = this.steer = this.previousSteer = this.distance = 0;
    this.gear = 1;
    this.rpm = 950;
    this.groundedWheels = 0;
    this.handbrake = 0;
    this.drift.reset();
    for (let i = 0; i < 4; i++) {
      this.wheelAngles[i] = this.previousWheelAngles[i] = 0;
      this.controller.setWheelFrictionSlip(i, VEHICLE.tireFriction);
      this.controller.setWheelSideFrictionStiffness(i, VEHICLE.sideFriction);
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
