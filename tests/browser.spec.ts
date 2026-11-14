import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function monitorContexts(page: Page) {
  await page.addInitScript(() => {
    const contexts: string[] = [];
    Reflect.set(window, "__requestedContexts", contexts);
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      contexts.push(String(args[0]));
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
}

async function expectNoWebGL(page: Page) {
  const contexts = await page.evaluate(
    () => Reflect.get(window, "__requestedContexts") as string[],
  );
  expect(contexts.filter((context) => /webgl/i.test(context))).toEqual([]);
}

test("missing WebGPU produces a clear error and retry never requests WebGL", async ({ page }) => {
  await monitorContexts(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("navigator.gpu");
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByRole("alert")).toContainText("navigator.gpu");
  await expect(page.getByRole("button", { name: "重置车辆" })).toBeDisabled();
  await expectNoWebGL(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("adapter and device failures are reported without fallback", async ({ page }) => {
  await monitorContexts(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: async () => null },
      configurable: true,
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("GPUAdapter");
  await expectNoWebGL(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter: async () => ({
          features: new Set(),
          requestDevice: async () => {
            throw new Error("测试：设备申请失败");
          },
        }),
      },
      configurable: true,
    }),
  );
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByRole("alert")).toContainText("测试：设备申请失败");
  await expectNoWebGL(page);
});

test("Three backend initialization rejection cannot activate its built-in fallback", async ({
  page,
}) => {
  await monitorContexts(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  const result = await page.evaluate(async (modulePath) => {
    const { StrictWebGPURenderer } = await import(modulePath);
    const renderer = new StrictWebGPURenderer();
    renderer.backend.init = async () => {
      throw new Error("injected backend failure");
    };
    try {
      await renderer.init();
      return "unexpected success";
    } catch (error) {
      return String(error);
    } finally {
      await renderer.dispose().catch(() => undefined);
    }
  }, "/src/rendering/Renderer.ts");
  expect(result).toContain("injected backend failure");
  await expectNoWebGL(page);
});

test("real WebGPU driving, pause/reset and responsive resize work", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await monitorContexts(page);
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await expect(page.getByTestId("backend")).toHaveText("WebGPU");
  await expect(page.locator("canvas")).toHaveCount(1);
  const startMapPosition = await page.getByTestId("map-marker").getAttribute("data-position");
  const startHeading = Number(await page.getByTestId("map-marker").getAttribute("data-heading"));
  await page.locator("summary").click();
  await expect
    .poll(async () => Number((await page.getByTestId("frames").innerText()).replaceAll(",", "")))
    .toBeGreaterThan(20);
  await expect(page.getByTestId("grounded")).toHaveText("4 / 4");
  await page.keyboard.down("s");
  await expect(page.getByTestId("gear")).toHaveText("R");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeLessThan(-5);
  await page.keyboard.up("s");
  await page.getByRole("button", { name: "重置车辆" }).click();
  await expect(page.getByTestId("map-marker")).toHaveAttribute("data-position", startMapPosition!);
  const contexts = await page.evaluate(
    () => Reflect.get(window, "__requestedContexts") as string[],
  );
  expect(contexts).toContain("webgpu");
  await expectNoWebGL(page);
  await page.keyboard.down("w");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(30);
  await page.keyboard.down("d");
  await expect
    .poll(async () => {
      const heading = Number(await page.getByTestId("map-marker").getAttribute("data-heading"));
      return ((heading - startHeading + 540) % 360) - 180;
    })
    .toBeGreaterThan(10);
  await page.keyboard.up("d");
  await page.keyboard.up("w");
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "暂停驾驶" }).click();
  const steps = await page.getByTestId("physics-steps").innerText();
  const frames = Number((await page.getByTestId("frames").innerText()).replaceAll(",", ""));
  await expect
    .poll(async () => Number((await page.getByTestId("frames").innerText()).replaceAll(",", "")))
    .toBeGreaterThan(frames + 5);
  expect(await page.getByTestId("physics-steps").innerText()).toBe(steps);
  await page.getByRole("button", { name: "重置车辆" }).click();
  await expect(page.getByTestId("speed")).toHaveAttribute("data-speed", "0.00");
  await page.getByRole("button", { name: "继续驾驶" }).click();
  await expect(page.getByTestId("grounded")).toHaveText("4 / 4");
  await page.getByLabel("渲染精度").selectOption("balanced");
  await expect
    .poll(() =>
      page
        .locator("canvas")
        .evaluate((canvas: HTMLCanvasElement) => canvas.width === Math.round(canvas.clientWidth)),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator("canvas")
        .evaluate((canvas: HTMLCanvasElement) => canvas.width === Math.round(canvas.clientWidth)),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true });
  const accelerator = page.getByRole("button", { name: "加速", exact: true });
  await accelerator.scrollIntoViewIfNeeded();
  const box = await accelerator.boundingBox();
  if (!box) throw new Error("Touch accelerator is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(5);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByTestId("throttle").getAttribute("data-value")))
    .toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test("左 Shift 在实际车辆中保持转向，释放后回正且重置清除锁定", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  const steering = async () =>
    Number(await page.getByTestId("steering").getAttribute("data-value"));
  await page.keyboard.down("a");
  await expect.poll(steering).toBeGreaterThan(0.3);
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.up("a");
  // 超过正常回正时间，实际前轮仍向左转。
  await page.waitForTimeout(700);
  expect(await steering()).toBeGreaterThan(0.3);
  await page.keyboard.up("ShiftLeft");
  await expect.poll(async () => Math.abs(await steering())).toBeLessThan(0.01);
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.up("ArrowRight");
  await expect.poll(steering).toBeLessThan(-0.3);
  await page.keyboard.press("r");
  await expect.poll(async () => Math.abs(await steering())).toBeLessThan(0.01);
  await page.keyboard.up("ShiftLeft");
  await page.screenshot({
    path: testInfo.outputPath("steering-guide.jpg"),
    type: "jpeg",
    quality: 65,
    scale: "css",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("操作说明按需弹出，支持全屏与横屏并恢复原有暂停状态", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  const help = page.getByRole("dialog", { name: "操作说明" });
  await expect(help).not.toBeVisible();
  await page
    .getByRole("button", { name: "操作说明", exact: true })
    .filter({ visible: true })
    .click();
  await expect(help).toBeVisible();
  await expect(page.getByText("驾驶已暂停", { exact: true })).toBeVisible();
  await expect(help.getByText("左 Shift", { exact: true })).toBeVisible();
  await page.keyboard.press("r");
  await page.keyboard.press("w");
  await expect(page.getByText("驾驶已暂停", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("help-desktop.jpg"),
    type: "jpeg",
    quality: 65,
    scale: "css",
  });
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "操作说明", exact: true })
    .filter({ visible: true })
    .click();
  await help.getByRole("button", { name: "关闭操作说明" }).click();
  await expect(page.getByText("驾驶已暂停", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("F11");
  await page.locator(".fullscreen-help").click();
  await expect(help).toBeVisible();
  expect(await help.evaluate((dialog) => document.fullscreenElement?.contains(dialog))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  await page.keyboard.press("F11");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator(".mobile-actions").getByRole("button", { name: "操作说明" }).click();
  await expect(help).toBeVisible();
  const box = await help.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(390);
  expect(box!.width).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: testInfo.outputPath("help-landscape.jpg"),
    type: "jpeg",
    quality: 65,
    scale: "css",
  });
  await help.getByRole("button", { name: "关闭操作说明" }).click();
  expect(errors).toEqual([]);
});

test("low-speed throttle and brake trigger burnout before a charged launch", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByTestId("speed")).toHaveAttribute("data-speed", "0.00");
  await page.keyboard.down("w");
  await page.keyboard.down("s");
  await page.keyboard.down("d");
  await expect(page.getByTestId("drift-state")).toContainText("烧胎蓄力");
  // 起步速度在回正后验证，避免持续满舵在达到目标速度前驶向护栏。
  await page.keyboard.up("d");
  await page.keyboard.up("s");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(20);
  await page.keyboard.up("w");
  expect(errors).toEqual([]);
});

test("low-speed throttle, handbrake and steering pivot around the front axle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  const pivotHeading = Number(await page.getByTestId("map-marker").getAttribute("data-heading"));
  await page.keyboard.down("w");
  await page.keyboard.down("Space");
  await page.keyboard.down("d");
  await expect(page.getByTestId("drift-state")).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("drift-state")).toHaveAttribute("data-active", "true");
  await expect
    .poll(async () => {
      const heading = Number(await page.getByTestId("map-marker").getAttribute("data-heading"));
      return Math.abs(((heading - pivotHeading + 540) % 360) - 180);
    })
    .toBeGreaterThan(30);
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeLessThan(18);
  await page.keyboard.up("d");
  await page.keyboard.up("Space");
  await page.keyboard.up("w");
  expect(errors).toEqual([]);
});

test("moving throttle and handbrake preserve driven wheel speed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.keyboard.down("w");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(35);
  await page.keyboard.down("Space");
  await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "1");
  await page.waitForTimeout(1500);
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(12);
  await page.keyboard.up("Space");
  await page.keyboard.up("w");
  expect(errors).toEqual([]);
});

test("fullscreen keeps diagnostic telemetry over the running WebGPU scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "进入全屏" }).click();
  const telemetry = page.getByLabel("全屏引擎信息");
  await expect(telemetry).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".driving-panel").evaluate((panel) => document.fullscreenElement === panel),
    )
    .toBe(true);
  await page.keyboard.press("c");
  await expect(page.getByTestId("camera-mode")).toHaveText("驾驶舱");
  await expect(page.locator(".driving-panel")).toHaveClass(/cockpit-view/);
  await expect(page.locator(".windshield-glass")).toBeVisible();
  await expect(page.locator(".cockpit-view .track-map")).toHaveCSS("transform", /matrix\(/);
  const [mapBox, panelBox] = await Promise.all([
    page.locator(".cockpit-view .track-map").boundingBox(),
    page.locator(".driving-panel").boundingBox(),
  ]);
  if (!mapBox || !panelBox) throw new Error("驾驶舱投影地图未显示");
  expect(Math.abs(mapBox.x + mapBox.width / 2 - (panelBox.x + panelBox.width / 2))).toBeLessThan(
    12,
  );
  expect(mapBox.y).toBeGreaterThan(panelBox.y + panelBox.height * 0.1);
  expect(mapBox.y + mapBox.height).toBeLessThan(panelBox.y + panelBox.height * 0.5);
  await expect(page.locator(".cockpit-view .track-map")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.keyboard.down("q");
  await page.waitForTimeout(180);
  const turnedMapBox = await page.locator(".cockpit-view .track-map").boundingBox();
  await page.keyboard.up("q");
  if (!turnedMapBox) throw new Error("左右观察后投影地图消失");
  expect(Math.abs(turnedMapBox.x - mapBox.x)).toBeLessThan(0.1);
  expect(Math.abs(turnedMapBox.y - mapBox.y)).toBeLessThan(0.1);
  expect(Math.abs(turnedMapBox.width - mapBox.width)).toBeLessThan(0.1);
  expect(Math.abs(turnedMapBox.height - mapBox.height)).toBeLessThan(0.1);
  const speedometer = page.locator(".speedometer");
  const [telemetryBox, speedometerBox] = await Promise.all([
    telemetry.boundingBox(),
    speedometer.boundingBox(),
  ]);
  if (!telemetryBox || !speedometerBox) throw new Error("全屏仪表信息未显示");
  const overlaps =
    telemetryBox.x < speedometerBox.x + speedometerBox.width &&
    telemetryBox.x + telemetryBox.width > speedometerBox.x &&
    telemetryBox.y < speedometerBox.y + speedometerBox.height &&
    telemetryBox.y + telemetryBox.height > speedometerBox.y;
  expect(overlaps).toBe(false);
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.locator(".driving-panel").evaluate((panel) => document.fullscreenElement !== panel),
    )
    .toBe(true);
});

test("F11 切换全屏，闲置鼠标隐藏且移动、点击和暂停恢复光标", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  const panel = page.locator(".driving-panel");
  const canvas = page.locator(".viewport canvas");
  const isFullscreen = () => panel.evaluate((element) => document.fullscreenElement === element);
  await page.keyboard.press("F11");
  await expect.poll(isFullscreen).toBe(true);
  await page.mouse.move(300, 300);
  await expect(canvas).not.toHaveCSS("cursor", "none");
  await expect(canvas).toHaveCSS("cursor", "none");
  await page.mouse.move(350, 300);
  await expect(canvas).not.toHaveCSS("cursor", "none");
  await expect(canvas).toHaveCSS("cursor", "none");
  await page.mouse.down();
  await page.mouse.up();
  await expect(canvas).not.toHaveCSS("cursor", "none");
  await page.screenshot({
    path: testInfo.outputPath("fullscreen.jpg"),
    type: "jpeg",
    quality: 65,
    scale: "css",
  });
  await page.keyboard.press("F11");
  await expect.poll(isFullscreen).toBe(false);
  await expect(canvas).not.toHaveCSS("cursor", "none");
  // 长按只切换一次，浏览器自动重复按键也不能触发原生全屏。
  await page.keyboard.down("F11");
  await expect.poll(isFullscreen).toBe(true);
  await page.keyboard.down("F11");
  await page.keyboard.up("F11");
  expect(await isFullscreen()).toBe(true);
  await expect(canvas).toHaveCSS("cursor", "none");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByText("驾驶已暂停", { exact: true })).toBeVisible();
  await expect(canvas).not.toHaveCSS("cursor", "none");
  await page.waitForTimeout(2700);
  await expect(canvas).not.toHaveCSS("cursor", "none");
  await page.keyboard.press("Escape");
  await expect.poll(isFullscreen).toBe(false);
  expect(errors).toEqual([]);
});

test("handbrake driving and all four views render with no GPU errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.keyboard.down("w");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(65);
  await page.keyboard.up("w");
  // 朝赛道的左弯转向，在护栏前为侧滑预留空间。
  await page.keyboard.down("a");
  await page.keyboard.down("Space");
  await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "1");
  await expect(page.getByTestId("drift-state")).toHaveAttribute("data-active", "true");
  await expect
    .poll(async () => Number(await page.getByTestId("smoke-count").textContent()))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("drifting.png"), fullPage: true });
  await page.keyboard.up("Space");
  await page.keyboard.up("a");
  await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "0");
  await page.getByRole("button", { name: "重置车辆" }).click();
  await expect(page.getByTestId("drift-state")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("smoke-count")).toHaveText("0");
  for (const [mode, label] of [
    ["cockpit", "驾驶舱"],
    ["hood", "引擎盖"],
    ["bumper", "保险杠"],
    ["chase", "追尾视角"],
  ]) {
    await page.keyboard.press("c");
    await expect(page.getByTestId("camera-mode")).toHaveText(label);
    await page.waitForTimeout(800); // 检查已完成的 0.65 秒镜头过渡。
    await page.screenshot({ path: testInfo.outputPath(`${mode}.png`), fullPage: true });
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(page.getByTestId("camera-mode")).toHaveText("驾驶舱");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath("cockpit-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = page.getByRole("button", { name: "手刹漂移" });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error("Handbrake touch control is missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "1");
  await button.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "0");
  expect(errors).toEqual([]);
});

test("losing focus pauses driving and clears a held throttle before resume", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.keyboard.down("w");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(10);
  await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByText("驾驶已暂停", { exact: true })).toBeVisible();
  const steps = await page.getByTestId("physics-steps").textContent();
  await page.waitForTimeout(200);
  expect(await page.getByTestId("physics-steps").textContent()).toBe(steps);
  await page.keyboard.up("w");
  await page.keyboard.up("Space");
  await page.getByRole("button", { name: "回到驾驶" }).click();
  await expect
    .poll(async () => Number(await page.getByTestId("throttle").getAttribute("data-value")))
    .toBeLessThan(0.01);
  await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "0");
  await page.keyboard.press("Escape");
  await expect(page.getByText("驾驶已暂停", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
});

test("device loss and uncaptured GPU errors stop rendering and allow a clean restart", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(window, "__destroyedDevices", 0);
    const original = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, ...args) {
      const device = await Reflect.apply(original, this, args);
      const nativeLost = device.lost;
      Object.defineProperty(device, "lost", {
        value: new Promise<Pick<GPUDeviceLostInfo, "reason" | "message">>((resolve) => {
          Reflect.set(window, "__loseDevice", () =>
            resolve({ reason: "unknown", message: "测试设备丢失" }),
          );
          void nativeLost.then(resolve);
        }),
      });
      const destroy = device.destroy.bind(device);
      device.destroy = () => {
        Reflect.set(window, "__destroyedDevices", Reflect.get(window, "__destroyedDevices") + 1);
        destroy();
      };
      Reflect.set(window, "__lastDevice", device);
      return device;
    };
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "__loseDevice")());
  await expect(page.getByRole("alert")).toContainText("测试设备丢失");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__destroyedDevices"))).toBe(1);
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.evaluate(() => {
    const device = Reflect.get(window, "__lastDevice") as GPUDevice;
    device.dispatchEvent(
      new GPUUncapturedErrorEvent("uncapturederror", {
        error: new GPUValidationError("测试渲染错误"),
      }),
    );
  });
  await expect(page.getByRole("alert")).toContainText("测试渲染错误");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__destroyedDevices"))).toBe(2);
  expect(errors).toEqual([]);
});
