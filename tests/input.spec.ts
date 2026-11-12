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
      cameras = 0;
    const input = new InputManager(
      () => pauses++,
      () => resets++,
      () => blurs++,
      () => cameras++,
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
      snapshots.callbacks = { pauses, resets, blurs, cameras };
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
  expect(result.callbacks).toEqual({ pauses: 2, resets: 1, blurs: 1, cameras: 2 });
  expect(result.pausesAfterDispose).toBe(2);
});
