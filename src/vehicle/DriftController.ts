import { VEHICLE } from "./config";

/** 仅管理抓地包络；所有横向位移和偏航均由 Rapier 轮胎冲量产生。 */
export class DriftController {
  rearGrip = 1;
  slipAngle = 0;
  active = false;
  duration = 0;
  control = 0;
  recovering = false;
  effectiveHandbrake = 0;
  pivoting = false;
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
    burnout: boolean,
    pivot: boolean,
  ): void {
    const config = VEHICLE.drift;
    if (burnout) {
      this.engaged = this.recovering = false;
      this.recoveryTime = 0;
      this.effectiveHandbrake = 0;
      this.pivoting = false;
      this.control += (1 - this.control) * (1 - Math.exp(-config.engageRate * dt));
      this.rearGrip +=
        (VEHICLE.burnout.rearGrip - this.rearGrip) * (1 - Math.exp(-config.engageRate * dt));
      return;
    }
    const pressed = handbrake > 0.2;
    if (!pressed) this.pivoting = false;
    // Pivot 仅是低速进入模式，而非行驶中漂移减速后的兜底模式；
    // 否则长距离过弯漂移会意外锁住前轴，变成原地旋转。
    if (pivot && !this.engaged && !this.active && !this.recovering && throttle > 0.1)
      this.pivoting = true;
    const available = (speed > config.minSpeed || this.pivoting) && grounded >= 3;
    if (pressed && !this.wasPressed && available) {
      // 普通紧弯的自然侧滑不算一次手刹起漂，只有已有辅助才允许二次手刹收车。
      if (this.engaged || (this.active && this.control > 0.01)) this.recoveryTime = 1.2;
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
    const poweredHold =
      pressed &&
      throttle > 0.1 &&
      (this.engaged || this.active || this.pivoting) &&
      !this.recovering;
    this.effectiveHandbrake = this.recovering
      ? 0
      : handbrake * (poweredHold ? config.heldHandbrakeBrakeFactor : 1);
    // 低速紧弯也可能达到侧滑检测阈值，不能因此自动接管普通转向。
    const targetControl =
      available &&
      (this.engaged || (this.active && this.control > 0.01) || this.recovering || this.pivoting)
        ? 1
        : 0;
    this.control += (targetControl - this.control) * (1 - Math.exp(-8 * dt));
    const countersteer = steer * this.slipAngle > 0;
    const powerSlip = this.engaged && !pressed ? 0.35 + throttle * 0.2 : 0;
    const target = this.recovering
      ? 1
      : poweredHold
        ? Math.max(config.rearGripMinimum, config.heldHandbrakeGrip - throttle * 0.08)
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
      (this.pivoting && groundedWheels >= 3) ||
      (longitudinal > VEHICLE.drift.minSpeed &&
        groundedWheels >= 3 &&
        Math.abs(this.slipAngle) > threshold);
    if (this.active) this.duration += dt;
  }

  reset(): void {
    this.rearGrip = 1;
    this.slipAngle = this.duration = 0;
    this.active = false;
    this.control = this.effectiveHandbrake = this.recoveryTime = this.settledTime = 0;
    this.engaged = this.wasPressed = this.recovering = this.pivoting = false;
  }
}
