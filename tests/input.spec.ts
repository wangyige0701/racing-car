import { test, expect } from "@playwright/test";

test("input release, focus loss, browser defaults and gamepad neutral latch", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  const result = await page.evaluate(async (modulePath) => {
    const { InputManager } = await import(modulePath);
    let pauses = 0,
      resets = 0,
      blurs = 0,
      cameras = 0,
      volume = 0;
    const input = new InputManager(
      () => pauses++,
      () => resets++,
      () => blurs++,
      () => cameras++,
      (amount: number) => (volume += amount),
      () => cameras++,
      (amount: number) => (volume += amount),
    );
    const pad = {
      connected: true,
      mapping: "standard",
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
    const snapshots: Record<string, unknown> = {};
    const key = (type: string, code: string, repeat = false) =>
      window.dispatchEvent(new KeyboardEvent(type, { code, repeat, cancelable: true }));
    try {
      snapshots.arrowDefaultAllowed = key("keydown", "ArrowUp");
      snapshots.held = { ...input.read() };
      key("keyup", "ArrowUp");
      snapshots.released = { ...input.read() };
      snapshots.spaceDefaultAllowed = key("keydown", "Space");
      snapshots.handbrake = { ...input.read() };
      key("keyup", "Space");
      snapshots.handbrakeReleased = { ...input.read() };
      key("keydown", "KeyC");
      key("keydown", "KeyC", true);
      key("keydown", "BracketLeft");
      key("keydown", "BracketLeft", true);
      key("keydown", "BracketRight");
      key("keydown", "KeyW");
      window.dispatchEvent(new Event("blur"));
      key("keydown", "KeyW", true);
      snapshots.blurred = { ...input.read() };
      key("keydown", "Escape");
      key("keydown", "Escape", true);
      key("keydown", "KeyR");
      key("keydown", "KeyR", true);
      pad.buttons[7].value = 1;
      input.poll();
      snapshots.heldOnConnect = { ...input.read() };
      pad.buttons[7].value = 0;
      input.poll();
      pad.buttons[7].value = 0.8;
      pad.axes[0] = 0.7;
      input.poll();
      snapshots.pad = { ...input.read() };
      input.enabled = false;
      input.clear();
      input.poll();
      snapshots.paused = { ...input.read() };
      input.enabled = true;
      input.poll();
      snapshots.resumedHeld = { ...input.read() };
      pad.buttons[7].value = 0;
      pad.axes[0] = 0.06;
      input.poll();
      pad.buttons[7].value = 0.6;
      input.poll();
      snapshots.repressed = { ...input.read() };
      pad.buttons[9].pressed = true;
      pad.buttons[2].pressed = true;
      pad.buttons[0].value = 1;
      input.poll();
      input.poll();
      snapshots.padHandbrake = { ...input.read() };
      input.clear();
      input.poll();
      snapshots.heldHandbrakeAfterClear = { ...input.read() };
      pad.buttons[0].value = pad.buttons[7].value = 0;
      input.poll();
      pad.buttons[0].value = 1;
      input.poll();
      snapshots.repressedHandbrake = { ...input.read() };
      snapshots.callbacks = { pauses, resets, blurs, cameras, volume };
    } finally {
      input.dispose();
    }
    key("keydown", "Escape");
    snapshots.pausesAfterDispose = pauses;
    return snapshots;
  }, "/src/input/InputManager.ts");
  expect(result.arrowDefaultAllowed).toBe(false);
  expect(result.spaceDefaultAllowed).toBe(false);
  expect(result.handbrake).toMatchObject({ handbrake: 1 });
  expect(result.handbrakeReleased).toMatchObject({ handbrake: 0 });
  expect(result.padHandbrake).toMatchObject({ handbrake: 1 });
  expect(result.heldHandbrakeAfterClear).toMatchObject({ handbrake: 0 });
  expect(result.repressedHandbrake).toMatchObject({ handbrake: 1 });
  expect(result.held).toEqual({ throttle: 1, brake: 0, steer: 0, handbrake: 0 });
  for (const name of ["released", "blurred", "heldOnConnect", "paused", "resumedHeld"])
    expect(result[name]).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: 0 });
  expect(result.pad).toMatchObject({ throttle: 0.8, brake: 0 });
  expect((result.pad as { steer: number; handbrake: 0 }).steer).toBeGreaterThan(0.5);
  expect(result.repressed).toEqual({ throttle: 0.6, brake: 0, steer: 0, handbrake: 0 });
  expect(result.callbacks).toEqual({ pauses: 2, resets: 1, blurs: 1, cameras: 2, volume: 0 });
  expect(result.pausesAfterDispose).toBe(2);
});

test("Escape exits fullscreen instead of pausing", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  const result = await page.evaluate(async (modulePath) => {
    const { InputManager } = await import(modulePath);
    let pauses = 0,
      exits = 0;
    const input = new InputManager(
      () => pauses++,
      () => {},
      () => {},
    );
    const original = document.exitFullscreen;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => {
        exits++;
        return Promise.resolve();
      },
    });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", cancelable: true }));
      return { pauses, exits };
    } finally {
      input.dispose();
      Object.defineProperty(document, "exitFullscreen", { configurable: true, value: original });
    }
  }, "/src/input/InputManager.ts");
  expect(result).toEqual({ pauses: 0, exits: 1 });
});

test("数字制动线性蓄力，连续点按及失焦重新起算，手柄保留模拟力度", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  const result = await page.evaluate(async (modulePath) => {
    const { InputManager } = await import(modulePath);
    const input = new InputManager(
      () => {},
      () => {},
      () => {},
    );
    const key = (type: string, code = "KeyS") =>
      window.dispatchEvent(new KeyboardEvent(type, { code }));
    try {
      key("keydown");
      const curve = [input.read().brake];
      for (let i = 0; i < 3; i++) curve.push(input.read(0.3).brake);
      const capped = input.read(5).brake;
      const taps: number[] = [];
      for (let i = 0; i < 5; i++) {
        // 两个物理步之间松开并再次按下，也必须重新开始轻刹。
        key("keyup");
        key("keydown");
        taps.push(input.read(0.1).brake);
      }
      key("keyup");
      const released = input.read().brake;
      key("keydown", "ArrowDown");
      const arrow = input.read(0.3).brake;
      key("keydown");
      key("keyup", "ArrowDown");
      const overlappingKeys = input.read(0.3).brake;
      input.clear();
      key("keydown");
      const afterClear = input.read().brake;
      input.read(1);
      window.dispatchEvent(new Event("blur"));
      key("keydown");
      const afterBlur = input.read().brake;
      input.enabled = false;
      const disabled = input.read(5).brake;
      input.clear();
      input.enabled = true;
      input.setTouch("brake", true);
      const touch = input.read(0.3).brake;
      input.setTouch("brake", false);
      input.setTouch("brake", true);
      const touchTap = input.read(0.1).brake;
      input.clear();
      const pad = {
        connected: true,
        mapping: "standard",
        axes: [0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
      input.poll();
      pad.buttons[6].value = 0.35;
      input.poll();
      const analog = [input.read().brake, input.read(5).brake];
      return {
        curve,
        capped,
        taps,
        released,
        arrow,
        overlappingKeys,
        afterClear,
        afterBlur,
        disabled,
        touch,
        touchTap,
        analog,
      };
    } finally {
      input.dispose();
    }
  }, "/src/input/InputManager.ts");
  expect(result.curve[0]).toBeCloseTo(0.12);
  for (let i = 1; i < result.curve.length; i++)
    expect(result.curve[i] - result.curve[i - 1]).toBeCloseTo((1 - 0.12) / 3);
  expect(result.capped).toBe(1);
  for (const tap of result.taps) {
    expect(tap).toBeGreaterThan(0.12);
    expect(tap).toBeLessThan(0.25);
  }
  expect(result.released).toBe(0);
  expect(result.arrow).toBeCloseTo(result.curve[1]);
  expect(result.overlappingKeys).toBeCloseTo(result.curve[2]);
  expect(result.afterClear).toBeCloseTo(0.12);
  expect(result.afterBlur).toBeCloseTo(0.12);
  expect(result.disabled).toBe(0);
  expect(result.touch).toBeCloseTo(result.curve[1]);
  expect(result.touchTap).toBeCloseTo(result.taps[0]);
  expect(result.analog).toEqual([0.35, 0.35]);
});
