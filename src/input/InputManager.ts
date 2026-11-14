import { emptyInput } from "../vehicle/config";
import type { DriverInput } from "../vehicle/config";

export type TouchControl = "throttle" | "brake" | "left" | "right" | "handbrake";
const drivingKeys = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyQ",
  "KeyE",
]);

/** 键盘、标准手柄和触控共用同一份归一化驾驶输入契约。 */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly touch = new Set<TouchControl>();
  private touchSteering = 0;
  private touchLook = 0;
  private readonly value = emptyInput();
  private readonly pad = emptyInput();
  private padNeedsNeutral = true;
  private pauseWasPressed = false;
  private resetWasPressed = false;
  private cameraWasPressed = false;
  enabled = true;
  source = "键盘";

  constructor(
    private readonly pause: () => void,
    private readonly reset: () => void,
    private readonly blur: () => void,
    private readonly camera: () => void = () => {},
    private readonly adjustVolume: (amount: number) => void = () => {},
  ) {
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.lostFocus);
    window.addEventListener("orientationchange", this.lostFocus);
  }

  private readonly keyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    )
      return;
    if (drivingKeys.has(event.code) || event.code === "Space") event.preventDefault();
    if (event.repeat) return;
    if (event.code === "Escape") {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        return;
      }
      event.preventDefault();
      this.pause();
      return;
    }
    if (event.code === "KeyR") {
      this.reset();
      return;
    }
    if (event.code === "KeyC") {
      event.preventDefault();
      this.camera();
      return;
    }
    if (event.code === "BracketLeft" || event.code === "BracketRight") {
      this.adjustVolume(event.code === "BracketLeft" ? -0.05 : 0.05);
      return;
    }
    if (this.enabled && drivingKeys.has(event.code)) {
      this.keys.add(event.code);
      this.source = "键盘";
    }
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
  private readonly lostFocus = (): void => {
    this.clear();
    this.blur();
  };

  setTouch(control: TouchControl, pressed: boolean): void {
    if (pressed && this.enabled) {
      this.touch.add(control);
      this.source = "触控";
    } else this.touch.delete(control);
  }

  setTouchSteering(value: number): void {
    this.touchSteering =
      this.enabled && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    if (this.touchSteering) this.source = "触控";
  }

  setLook(value: number): void {
    this.touchLook = this.enabled ? Math.max(-1, Math.min(1, value)) : 0;
  }
  readLook(): number {
    return this.enabled
      ? Number(this.keys.has("KeyQ")) - Number(this.keys.has("KeyE")) || this.touchLook
      : 0;
  }

  /** 暂停时也采样功能按键，以便通过 Start 恢复驾驶。 */
  poll(): void {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(
      (p) => p?.connected && p.mapping === "standard",
    );
    const pause = pad?.buttons[9]?.pressed ?? false;
    const reset = pad?.buttons[3]?.pressed ?? false;
    const camera = pad?.buttons[2]?.pressed ?? false;
    if (pause && !this.pauseWasPressed) this.pause();
    if (reset && !this.resetWasPressed) this.reset();
    if (camera && !this.cameraWasPressed) this.camera();
    this.pauseWasPressed = pause;
    this.resetWasPressed = reset;
    this.cameraWasPressed = camera;
    const axis = pad?.axes[0] ?? 0;
    const steer = Math.abs(axis) < 0.12 ? 0 : (Math.sign(axis) * (Math.abs(axis) - 0.12)) / 0.88;
    const throttle = pad?.buttons[7]?.value ?? 0,
      brake = pad?.buttons[6]?.value ?? 0;
    const handbrake = pad?.buttons[0]?.value ?? 0;
    if (!pad) this.padNeedsNeutral = true;
    if (pad && throttle < 0.05 && brake < 0.05 && handbrake < 0.05 && steer === 0)
      this.padNeedsNeutral = false;
    this.pad.throttle = this.padNeedsNeutral ? 0 : throttle;
    this.pad.brake = this.padNeedsNeutral ? 0 : brake;
    this.pad.steer = this.padNeedsNeutral ? 0 : steer;
    this.pad.handbrake = this.padNeedsNeutral ? 0 : handbrake;
    if (
      !this.padNeedsNeutral &&
      (throttle > 0.05 || brake > 0.05 || handbrake > 0.05 || steer !== 0)
    )
      this.source = "手柄";
  }

  read(): DriverInput {
    if (!this.enabled) {
      this.value.throttle = this.value.brake = this.value.steer = this.value.handbrake = 0;
      return this.value;
    }
    this.value.throttle = Math.max(
      this.pad.throttle,
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.touch.has("throttle")),
    );
    this.value.brake = Math.max(
      this.pad.brake,
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.touch.has("brake")),
    );
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft") || this.touch.has("left");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight") || this.touch.has("right");
    this.value.steer =
      left || right ? Number(right) - Number(left) : this.touchSteering || this.pad.steer;
    this.value.handbrake = Math.max(
      this.pad.handbrake,
      Number(this.keys.has("Space") || this.touch.has("handbrake")),
    );
    return this.value;
  }

  clear(): void {
    this.keys.clear();
    this.touch.clear();
    this.touchSteering = 0;
    this.touchLook = 0;
    this.padNeedsNeutral = true;
    this.pad.throttle = this.pad.brake = this.pad.steer = this.pad.handbrake = 0;
    this.value.throttle = this.value.brake = this.value.steer = this.value.handbrake = 0;
  }

  dispose(): void {
    this.clear();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.lostFocus);
    window.removeEventListener("orientationchange", this.lostFocus);
  }
}
