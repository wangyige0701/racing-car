import { test, expect } from "@playwright/test";

test("input release, focus loss, browser defaults and gamepad neutral latch", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  const result = await page.evaluate(async (modulePath) => {
    const { InputManager } = await import(modulePath);
    let pauses = 0,
      resets = 0,
      blurs = 0;
    const input = new InputManager(
      () => pauses++,
      () => resets++,
      () => blurs++,
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
      input.poll();
      input.poll();
      snapshots.callbacks = { pauses, resets, blurs };
    } finally {
      input.dispose();
    }
    key("keydown", "Escape");
    snapshots.pausesAfterDispose = pauses;
    return snapshots;
  }, "/src/input/InputManager.ts");
  expect(result.arrowDefaultAllowed).toBe(false);
  expect(result.held).toEqual({ throttle: 1, brake: 0, steer: 0 });
  for (const name of ["released", "blurred", "heldOnConnect", "paused", "resumedHeld"])
    expect(result[name]).toEqual({ throttle: 0, brake: 0, steer: 0 });
  expect(result.pad).toMatchObject({ throttle: 0.8, brake: 0 });
  expect((result.pad as { steer: number }).steer).toBeGreaterThan(0.5);
  expect(result.repressed).toEqual({ throttle: 0.6, brake: 0, steer: 0 });
  expect(result.callbacks).toEqual({ pauses: 2, resets: 1, blurs: 1 });
  expect(result.pausesAfterDispose).toBe(2);
});
