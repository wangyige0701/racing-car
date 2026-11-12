import { emptyInput } from "../vehicle/config";
import type { DriverInput } from "../vehicle/config";

export type TouchControl = "throttle" | "brake" | "left" | "right";
const drivingKeys = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** Keyboard, standard gamepad and touch feed the same normalized driver contract. */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly touch = new Set<TouchControl>();
  private readonly value = emptyInput();
  private readonly pad = emptyInput();
  private padNeedsNeutral = true;
  private pauseWasPressed = false;
  private resetWasPressed = false;
  enabled = true;
  source = "键盘";

  constructor(
    private readonly pause: () => void,
    private readonly reset: () => void,
    private readonly blur: () => void,
  ) {
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.lostFocus);
  }

  private readonly keyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (event.code === "Space" && target instanceof HTMLButtonElement) return;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    )
      return;
    if (drivingKeys.has(event.code) || event.code === "Space") event.preventDefault();
    if (event.repeat) return;
    if (event.code === "Escape") {
      event.preventDefault();
      this.pause();
      return;
    }
    if (event.code === "KeyR") {
      this.reset();
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

  /** Action buttons are sampled while paused too, allowing Start to resume. */
  poll(): void {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(
      (p) => p?.connected && p.mapping === "standard",
    );
    const pause = pad?.buttons[9]?.pressed ?? false;
    const reset = pad?.buttons[3]?.pressed ?? false;
    if (pause && !this.pauseWasPressed) this.pause();
    if (reset && !this.resetWasPressed) this.reset();
    this.pauseWasPressed = pause;
    this.resetWasPressed = reset;
    const axis = pad?.axes[0] ?? 0;
    const steer = Math.abs(axis) < 0.12 ? 0 : (Math.sign(axis) * (Math.abs(axis) - 0.12)) / 0.88;
    const throttle = pad?.buttons[7]?.value ?? 0,
      brake = pad?.buttons[6]?.value ?? 0;
    if (!pad) this.padNeedsNeutral = true;
    if (pad && throttle < 0.05 && brake < 0.05 && steer === 0) this.padNeedsNeutral = false;
    this.pad.throttle = this.padNeedsNeutral ? 0 : throttle;
    this.pad.brake = this.padNeedsNeutral ? 0 : brake;
    this.pad.steer = this.padNeedsNeutral ? 0 : steer;
    if (!this.padNeedsNeutral && (throttle > 0.05 || brake > 0.05 || steer !== 0))
      this.source = "手柄";
  }

  read(): DriverInput {
    if (!this.enabled) {
      this.value.throttle = this.value.brake = this.value.steer = 0;
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
    this.value.steer = left || right ? Number(right) - Number(left) : this.pad.steer;
    return this.value;
  }

  clear(): void {
    this.keys.clear();
    this.touch.clear();
    this.padNeedsNeutral = true;
    this.pad.throttle = this.pad.brake = this.pad.steer = 0;
    this.value.throttle = this.value.brake = this.value.steer = 0;
  }

  dispose(): void {
    this.clear();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.lostFocus);
  }
}
