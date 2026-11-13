import { VEHICLE } from "./config";

/** Grip envelope only: Rapier tire impulses produce all lateral movement and yaw. */
export class DriftController {
  rearGrip = 1;
  slipAngle = 0;
  active = false;
  duration = 0;
  control = 0;
  recovering = false;
  effectiveHandbrake = 0;
  private engaged = false;
  private wasPressed = false;
  private recoveryTime = 0;
  private settledTime = 0;

  updateGrip(
    dt: number,
    handbrake: number,
    throttle: number,
    steer: number,
    speed: number,
    brake: number,
    grounded: number,
  ): void {
    const config = VEHICLE.drift;
    const pressed = handbrake > 0.2;
    const available = speed > config.minSpeed && grounded >= 3;
    if (pressed && !this.wasPressed && available) {
      if (this.engaged || this.active) this.recoveryTime = 1.2;
      else this.engaged = true;
    }
    this.wasPressed = pressed;
    if ((brake > 0.1 || (this.recovering && pressed)) && available) this.recoveryTime = 1.2;
    this.recoveryTime = Math.max(0, this.recoveryTime - dt);
    this.recovering = this.recoveryTime > 0;
    if (this.recovering || !available) this.engaged = false;
    this.settledTime =
      !pressed && Math.abs(this.slipAngle) < config.exitAngle ? this.settledTime + dt : 0;
    if (this.settledTime > 0.7 || (!pressed && throttle < 0.1)) this.engaged = false;
    this.effectiveHandbrake = this.recovering ? 0 : handbrake;
    const targetControl = available && (this.engaged || this.active || this.recovering) ? 1 : 0;
    this.control += (targetControl - this.control) * (1 - Math.exp(-8 * dt));
    const countersteer = steer * this.slipAngle > 0;
    const powerSlip = this.engaged && !pressed ? 0.35 + throttle * 0.2 : 0;
    const target = this.recovering
      ? 1
      : Math.max(
          config.rearGripMinimum,
          1 - this.effectiveHandbrake * (1 - config.rearGripMinimum) - powerSlip,
        );
    const rate =
      target < this.rearGrip
        ? config.engageRate
        : config.releaseRate * (this.recovering ? 2.5 : countersteer ? 1.35 : 1);
    this.rearGrip += (target - this.rearGrip) * (1 - Math.exp(-rate * dt));
  }

  measure(dt: number, longitudinal: number, lateral: number, groundedWheels: number): void {
    this.slipAngle =
      Math.hypot(longitudinal, lateral) > 0.5
        ? Math.atan2(lateral, Math.max(0.1, Math.abs(longitudinal)))
        : 0;
    const threshold = this.active ? VEHICLE.drift.exitAngle : VEHICLE.drift.enterAngle;
    this.active =
      longitudinal > VEHICLE.drift.minSpeed &&
      groundedWheels >= 3 &&
      Math.abs(this.slipAngle) > threshold;
    if (this.active) this.duration += dt;
  }

  reset(): void {
    this.rearGrip = 1;
    this.slipAngle = this.duration = 0;
    this.active = false;
    this.control = this.effectiveHandbrake = this.recoveryTime = this.settledTime = 0;
    this.engaged = this.wasPressed = this.recovering = false;
  }
}
