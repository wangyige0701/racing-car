import { VEHICLE } from "./config";

/** Grip envelope only: Rapier tire impulses produce all lateral movement and yaw. */
export class DriftController {
  rearGrip = 1;
  slipAngle = 0;
  active = false;
  duration = 0;

  updateGrip(dt: number, handbrake: number, throttle: number, steer: number, speed: number): void {
    const config = VEHICLE.drift;
    // A sliding, driven rear axle retains some slip after release, then recovers
    // as the driver countersteers or lifts. Never remove lateral traction entirely.
    const slip = Math.max(0, Math.abs(this.slipAngle) - config.exitAngle);
    const speedBlend = Math.max(0, Math.min(1, (speed - config.minSpeed) / 3));
    const powerSlip = speedBlend * Math.min(0.22, slip * throttle * 0.5);
    const countersteer = steer * this.slipAngle > 0;
    const target = Math.max(
      config.rearGripMinimum,
      1 - handbrake * (1 - config.rearGripMinimum) - powerSlip,
    );
    const rate =
      target < this.rearGrip ? config.engageRate : config.releaseRate * (countersteer ? 1.35 : 1);
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
  }
}
