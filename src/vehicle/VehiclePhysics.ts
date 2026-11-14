import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three/webgpu";
import { VEHICLE, steeringLimit } from "./config";
import { COLLISION_GROUPS } from "../physics/collisionGroups";
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
  burnout = false;
  launchCharge = 0;
  launchBoost = 0;
  private steeringSensitivity: number = VEHICLE.steeringSensitivity.default;
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
  private readonly angularCorrection = new Vector3();
  private readonly pivotPoint = new Vector3();
  private readonly pivotVelocity = new Vector3();

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
        // 护栏碰撞必须损失横滚和俯仰能量，避免轻微擦碰演变为长时间腾空翻滚。
        .setAngularDamping(1.8)
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(0.79, 0.11, 1.92, 0.12)
        .setTranslation(0, 0.12, 0)
        .setDensity(0)
        .setFriction(0.1)
        .setRestitution(0)
        .setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS,
        )
        .setContactForceEventThreshold(200),
      this.body,
    );
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    // Rapier 0.21 的公开 API 将此设置器命名为 setIndexForwardAxis。
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
    const steerInput = Math.max(-1, Math.min(1, input.steer));
    this.handbrake = Math.max(0, Math.min(1, input.handbrake));
    this.body.linvel(this.velocity);
    const movement = this.velocity.length();
    const both = accelerator > 0.05 && pedal > 0.05;
    const desired = accelerator > 0.05 ? 1 : pedal > 0.05 ? -1 : 0;
    let drive = 0;
    this.brake = 0;
    this.burnout =
      both &&
      this.direction === 1 &&
      movement < VEHICLE.burnout.engageSpeed &&
      this.groundedWheels >= 3;
    const lowSpeedPivotRequest =
      this.handbrake > 0.2 &&
      accelerator > 0.05 &&
      movement < VEHICLE.drift.pivotMaxSpeed &&
      this.groundedWheels >= 3;
    if (both) {
      // 烧胎需要锁住前轴；行驶中则保留脚刹力度，油门不能把轻刹提升为满刹。
      this.brake = this.burnout ? Math.max(accelerator, pedal) : pedal;
      if (this.burnout) drive = accelerator;
      this.directionWait = 0;
    } else if (desired !== 0) {
      if (desired !== this.direction) {
        this.brake = desired === 1 ? accelerator : pedal;
        // 横移车辆的前向速度可能接近零，但整体仍在高速移动；只有真正停稳后才允许换向。
        this.directionWait = this.velocity.length() < 0.6 ? this.directionWait + dt : 0;
        if (this.directionWait >= VEHICLE.directionDelay) {
          this.direction = desired;
          this.directionWait = 0;
          this.brake = 0;
        }
      } else this.directionWait = 0;
      if (desired === this.direction) drive = desired === 1 ? accelerator : pedal;
    } else this.directionWait = 0;
    const targetThrottle = drive;
    this.throttle += (targetThrottle - this.throttle) * (1 - Math.exp(-VEHICLE.throttleRate * dt));
    if (this.brake > 0 && !this.burnout) this.throttle = 0;
    this.drift.updateGrip(
      dt,
      this.handbrake,
      this.throttle,
      this.steer,
      this.speed,
      this.brake,
      this.groundedWheels,
      this.burnout,
      lowSpeedPivotRequest,
    );
    const handbrakePivot = this.drift.pivoting && this.groundedWheels >= 3;
    const handbrake = this.drift.effectiveHandbrake;
    const heldPoweredDrift = this.handbrake > 0.2 && this.throttle > 0.1 && !this.drift.recovering;
    const countersteer =
      this.groundedWheels >= 3 &&
      this.speed > VEHICLE.drift.minSpeed &&
      -steerInput * this.drift.slipAngle > 0;
    const slide = Math.min(1, Math.abs(this.drift.slipAngle) / 0.4);
    const steerLimit = Math.min(
      VEHICLE.maxSteer,
      (steeringLimit(this.speed) * (1 - this.drift.control) +
        (VEHICLE.drift.maxSteer /
          (1 + (Math.abs(this.speed) / VEHICLE.drift.steeringSpeedScale) ** 2)) *
          this.drift.control) *
        (1 + (countersteer ? VEHICLE.countersteerReserve * slide : 0)),
    );
    const driftSteerLimit =
      steerLimit +
      (heldPoweredDrift
        ? (Math.max(steerLimit, VEHICLE.drift.maxSteer * VEHICLE.drift.driftSteerLimitFloor) -
            steerLimit) *
          this.drift.control
        : 0);
    // 侧滑时保留大部分驾驶员转向权限，再让前轴向测得的速度方向对齐。
    // 这是常见的街机漂移模型：转向选择弧线，速度对齐提供反打，
    // 而不会取代玩家输入。
    const driverSteer =
      -steerInput *
      driftSteerLimit *
      // 辅助权重指数衰减不会精确归零，不能按布尔值判断，否则回正后仍永久削弱转向。
      (1 -
        this.drift.control *
          (1 -
            (heldPoweredDrift
              ? VEHICLE.drift.heldDriverSteerRetention
              : VEHICLE.drift.driverSteerRetention)));
    const rawCountersteer =
      this.drift.slipAngle * this.drift.control * VEHICLE.drift.countersteerAssist;
    const countersteerAssist = heldPoweredDrift
      ? Math.max(
          -driftSteerLimit * VEHICLE.drift.countersteerLimit,
          Math.min(driftSteerLimit * VEHICLE.drift.countersteerLimit, rawCountersteer),
        )
      : rawCountersteer;
    const steeredTowardDriver = driverSteer + countersteerAssist;
    // 速度对齐项可以缓和侧滑，但不得反转持续的转向指令；方向仍由驾驶员决定。
    const minimumDriverSteer = driverSteer * VEHICLE.drift.driverSteerMinimum;
    const targetSteer = handbrakePivot
      ? -steerInput * VEHICLE.drift.maxSteer
      : Math.max(
          -VEHICLE.maxSteer,
          Math.min(
            VEHICLE.maxSteer,
            heldPoweredDrift &&
              Math.abs(steerInput) > 0.08 &&
              (driverSteer * steeredTowardDriver < 0 ||
                Math.abs(steeredTowardDriver) < Math.abs(minimumDriverSteer))
              ? minimumDriverSteer
              : steeredTowardDriver,
          ),
        );
    this.steer +=
      (targetSteer - this.steer) *
      (1 -
        Math.exp(
          -(countersteer ? VEHICLE.countersteerRate : VEHICLE.steeringRate) *
            this.steeringSensitivity *
            dt,
        ));
    const speed = Math.abs(this.speed);
    // 车辆开始侧滑后，持续手刹只减弱而不切断驱动力，以便保持长距离动力漂移。
    const clutchCut = handbrake * (this.drift.active ? 0.4 : 1);
    this.driveCoupling = Math.min(
      1 - clutchCut,
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
    if (this.burnout) this.rpm = Math.max(this.rpm, 2600 + this.launchCharge * accelerator * 4200);
    if (this.burnout) {
      this.launchCharge = Math.min(1, this.launchCharge + VEHICLE.burnout.chargeRate * dt);
      this.launchBoost = 0;
    } else {
      const launching =
        pedal < 0.05 &&
        accelerator > 0.05 &&
        this.direction === 1 &&
        speed < VEHICLE.burnout.maxLaunchSpeed;
      this.launchBoost = launching ? this.launchCharge * VEHICLE.burnout.launchForce : 0;
      this.launchCharge = Math.max(
        0,
        this.launchCharge - dt * (launching ? VEHICLE.burnout.releaseRate : 3),
      );
    }
    const torque =
      VEHICLE.maxTorque * (0.68 + 0.32 * Math.sin(Math.min(1, this.rpm / 7400) * Math.PI));
    const speedLimit = this.direction === 1 ? VEHICLE.maxSpeed : VEHICLE.reverseSpeed;
    const taper = Math.max(0, 1 - (speed / speedLimit) ** 4);
    const driveForce =
      ((torque * ratio * VEHICLE.finalDrive * VEHICLE.efficiency) / VEHICLE.wheelRadius) *
      this.throttle *
      taper *
      (1 + this.launchBoost) *
      (this.burnout ? Math.max(0, 1 - (movement / VEHICLE.burnout.maxCreepSpeed) ** 2) : 1) *
      this.direction;
    const engineBrake =
      drive === 0 && this.brake === 0 && !this.burnout
        ? VEHICLE.engineBrakeForce *
          (1 - this.throttle) *
          this.driveCoupling *
          (1 - this.drift.control * 0.65)
        : 0;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, i < 2 ? this.steer : 0);
      const rear = i >= 2;
      const grip =
        (rear ? this.drift.rearGrip : 1) *
        (1 + VEHICLE.corneringGripBoost * (1 - this.drift.control));
      const serviceBrake = this.burnout
        ? rear
          ? 0
          : (this.brake * VEHICLE.maxBrakeForce) / 2
        : (this.brake * VEHICLE.maxBrakeForce) / 4;
      this.controller.setWheelFrictionSlip(i, VEHICLE.tireFriction * grip);
      this.controller.setWheelSideFrictionStiffness(i, VEHICLE.sideFriction * grip);
      this.controller.setWheelEngineForce(i, rear ? (driveForce * this.driveCoupling) / 2 : 0);
      this.controller.setWheelBrake(
        i,
        dt *
          (serviceBrake +
            (rear ? (handbrake * VEHICLE.handbrakeForce) / 2 : 0) +
            (this.drift.recovering ? this.handbrake * VEHICLE.maxBrakeForce * 0.12 : 0)),
      );
    }
    this.body.resetForces(false);
    this.body.resetTorques(false);
    this.body.linvel(this.velocity);
    const velocityMagnitude = this.velocity.length();
    this.force.copy(this.velocity).multiplyScalar(-0.45 * velocityMagnitude);
    if (this.groundedWheels >= 2) {
      this.force.y -= Math.min(3500, speed * speed * 1.8);
      // Rapier 的车轮驱动力与制动冲量互斥；衰减中的油门非零时，轮刹不能承担滑行阻力。
      // 因此用接地纵向力模拟滚阻和发动机制动，低速平滑收敛，不直接修改速度。
      this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
      const longitudinal = this.velocity.dot(this.forward);
      const resistance =
        (VEHICLE.rollingResistance * (1 - this.drift.control * 0.75) + engineBrake) *
        Math.min(1, Math.abs(longitudinal));
      this.force.addScaledVector(this.forward, -Math.sign(longitudinal) * resistance);
      // 烧胎后的附加起步力绕过短暂的后轮低抓地恢复区，仍只通过刚体力推进。
      const launchAssist =
        this.launchBoost *
        VEHICLE.burnout.launchAssistForce *
        Math.max(0, 1 - speed / VEHICLE.burnout.launchAssistSpeed);
      if (launchAssist > 0) this.force.addScaledVector(this.forward, launchAssist);
    }
    this.body.addForce(this.force, false);
    if (this.throttle > 0.01 || this.brake > 0 || this.handbrake > 0) this.body.wakeUp();
    this.controller.updateVehicle(
      dt,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      COLLISION_GROUPS.suspension,
    );
    // 等大反向力耦合每根车轴的悬挂，且不会额外产生升力。
    // 腾空的车轴不施加稳定力。
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.controller.wheelIsInContact(i)) contacts++;
    const stationarySpin = (this.burnout || handbrakePivot) && Math.abs(steerInput) > 0.12;
    if (handbrakePivot && Math.abs(steerInput) > 0.12 && contacts >= 3) {
      // 前轴施加有限且较强的轮胎力，使其保持在小半径附近；后轴保留驱动和低抓地，
      // 因而扫出更大的弧线，且不传送车体或覆写 Rapier 速度。
      this.pivotPoint
        .set(0, 0, VEHICLE.wheelConnections[0].z)
        .applyQuaternion(this.rotation)
        .add(this.position);
      this.body.velocityAtPoint(this.pivotPoint, this.pivotVelocity);
      this.pivotVelocity.y = 0;
      this.force
        .copy(this.pivotVelocity)
        .multiplyScalar(-VEHICLE.drift.pivotFrontAnchorDamping)
        .clampLength(0, VEHICLE.drift.pivotFrontAnchorForce);
      this.body.addForceAtPoint(this.force, this.pivotPoint, false);
    }
    if (contacts >= 3 && (speed > VEHICLE.drift.minSpeed || stationarySpin)) {
      this.body.angvel(this.angularVelocity);
      const yawRate = this.angularVelocity.dot(this.up);
      const control = stationarySpin ? 1 : this.drift.control;
      const targetSlip = this.drift.recovering
        ? 0
        : steerInput * VEHICLE.drift.targetSlip * (0.5 + this.throttle * 0.5) +
          handbrake * steerInput * 0.25;
      const requestedYaw = -steerInput * Math.min(0.85, 12 / Math.max(7, speed));
      const desiredYaw = stationarySpin
        ? -steerInput * (this.burnout ? VEHICLE.burnout.yawRate : VEHICLE.drift.pivotYawRate)
        : requestedYaw + (this.drift.slipAngle - targetSlip) * VEHICLE.drift.slipRecovery;
      // 侧滑恢复可以减缓正在出现的自旋，但不能令持续方向指令把车身转向另一侧。
      const targetYaw =
        !stationarySpin &&
        heldPoweredDrift &&
        Math.abs(steerInput) > 0.08 &&
        desiredYaw * requestedYaw < 0
          ? requestedYaw * VEHICLE.drift.driverYawRetention
          : desiredYaw;
      const maxTorque = stationarySpin
        ? this.burnout
          ? VEHICLE.burnout.maxYawTorque
          : VEHICLE.drift.pivotMaxTorque
        : VEHICLE.drift.maxAssistTorque;
      const correction = Math.max(
        -maxTorque,
        Math.min(maxTorque, (targetYaw - yawRate) * VEHICLE.inertia.y * VEHICLE.drift.yawResponse),
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
    if (contacts >= 3) {
      this.body.angvel(this.angularVelocity);
      this.force
        .set(-this.up.z, 0, this.up.x)
        .multiplyScalar(VEHICLE.uprightStiffness)
        .addScaledVector(
          this.angularCorrection
            .copy(this.angularVelocity)
            .addScaledVector(this.up, -this.angularVelocity.dot(this.up)),
          -VEHICLE.uprightDamping,
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

  setSteeringSensitivity(value: number): void {
    this.steeringSensitivity = Math.max(
      VEHICLE.steeringSensitivity.min,
      Math.min(VEHICLE.steeringSensitivity.max, value),
    );
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
      // 手刹会使后轮逐渐锁止，悬挂仍保持独立。
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
    this.burnout = false;
    this.launchCharge = this.launchBoost = 0;
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
