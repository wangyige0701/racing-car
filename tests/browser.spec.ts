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
  await expect(page.getByRole("button", { name: "重新投放刚体" })).toBeDisabled();
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

test("real WebGPU renders, Rapier settles, pause/reset and responsive resize work", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await monitorContexts(page);
  await page.goto("/");
  await expect(page.getByText("实时运行中", { exact: true })).toBeVisible();
  await expect(page.getByTestId("backend")).toHaveText("WebGPU");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect
    .poll(async () => Number((await page.getByTestId("frames").innerText()).replaceAll(",", "")))
    .toBeGreaterThan(20);
  await expect(page.locator(".scene-scale")).toContainText("Y 0.90 m");
  const contexts = await page.evaluate(
    () => Reflect.get(window, "__requestedContexts") as string[],
  );
  expect(contexts).toContain("webgpu");
  await expectNoWebGL(page);
  await page.getByRole("button", { name: "暂停模拟" }).click();
  const steps = await page.getByTestId("physics-steps").innerText();
  const frames = Number((await page.getByTestId("frames").innerText()).replaceAll(",", ""));
  await expect
    .poll(async () => Number((await page.getByTestId("frames").innerText()).replaceAll(",", "")))
    .toBeGreaterThan(frames + 5);
  expect(await page.getByTestId("physics-steps").innerText()).toBe(steps);
  await page.getByRole("button", { name: "重新投放刚体" }).click();
  await expect(page.locator(".scene-scale")).toContainText("Y 4.00 m");
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "继续模拟" }).click();
  await expect(page.locator(".scene-scale")).toContainText("Y 0.90 m");
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
  expect(errors).toEqual([]);
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
  await expect(page.getByText("实时运行中", { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "__loseDevice")());
  await expect(page.getByRole("alert")).toContainText("测试设备丢失");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__destroyedDevices"))).toBe(1);
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByText("实时运行中", { exact: true })).toBeVisible();
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
