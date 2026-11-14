import { test, expect } from "@playwright/test";

test("驾驶舱正视与左右观察保持完整风挡和嵌入仪表，切换后没有 GPU 错误", async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.locator(".quality-control select").selectOption("balanced");
  await page.locator(".quality-control select").blur();
  await page.keyboard.press("c");
  await page.keyboard.press("F11");
  await expect(page.getByTestId("camera-mode")).toHaveText("驾驶舱");
  for (const [name, key] of [
    ["front", ""],
    ["left", "q"],
    ["right", "e"],
  ]) {
    if (key) await page.keyboard.down(key);
    await page.waitForTimeout(1100);
    await page.screenshot({
      path: info.outputPath(`cockpit-${name}.jpg`),
      type: "jpeg",
      quality: 85,
      scale: "css",
    });
    if (key) await page.keyboard.up(key);
  }
  await page.waitForTimeout(1000);
  await page.keyboard.press("F11");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(800);
  const map = await page.locator(".track-map").boundingBox();
  const panel = await page.locator(".driving-panel").boundingBox();
  expect(map!.y + map!.height).toBeLessThan(panel!.y + panel!.height * 0.5);
  await page.screenshot({
    path: info.outputPath("cockpit-window.jpg"),
    type: "jpeg",
    quality: 85,
    scale: "css",
  });
  for (const [name, fov, height, back] of [
    ["low-forward", "55", "-0.04", "-0.08"],
    ["high-back", "80", "0.08", "0.06"],
  ]) {
    await page.keyboard.press("Escape");
    if (
      !(await page
        .locator(".camera-settings")
        .evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await page.locator(".camera-settings summary").click();
    await page.getByLabel("驾驶舱视野", { exact: true }).fill(fov);
    await page.getByLabel("座椅高度", { exact: true }).fill(height);
    await page.getByLabel("座椅后移", { exact: true }).fill(back);
    await page.getByLabel("座椅后移", { exact: true }).blur();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    await page.screenshot({
      path: info.outputPath(`cockpit-${name}.jpg`),
      type: "jpeg",
      quality: 85,
      scale: "css",
    });
  }
  await page.keyboard.press("Escape");
  if (
    !(await page
      .locator(".camera-settings")
      .evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await page.locator(".camera-settings summary").click();
  await page.getByLabel("驾驶舱视野", { exact: true }).fill("65");
  await page.getByLabel("座椅高度", { exact: true }).fill("0");
  await page.getByLabel("座椅后移", { exact: true }).fill("0");
  await page.getByLabel("座椅后移", { exact: true }).blur();
  await page.keyboard.press("Escape");
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(900);
    const projection = await page.locator(".track-map").boundingBox();
    const lap = await page.getByTestId("lap-hud").boundingBox();
    const look = await page.locator(".look-controls").boundingBox();
    expect(projection!.y).toBeGreaterThan(lap!.y + lap!.height);
    expect(look!.y).toBeGreaterThan(viewport.height * 0.75);
    await page.screenshot({
      path: info.outputPath(`cockpit-landscape-${viewport.width}.jpg`),
      type: "jpeg",
      quality: 85,
      scale: "css",
    });
  }
  await page.keyboard.press("c");
  await expect(page.getByTestId("camera-mode")).toHaveText("引擎盖");
  expect(errors).toEqual([]);
});

test("仪表与遮光罩使用同一局部坐标且屏面凹入，原内饰只在外部视角恢复", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const visualPath = "/src/vehicle/VehicleVisual.ts";
    const disposePath = "/src/rendering/dispose.ts";
    const { VehicleVisual } = await import(visualPath);
    const { disposeObject } = await import(disposePath);
    const visual = await VehicleVisual.load(new AbortController().signal);
    const root = visual.root;
    const screen = root.getObjectByName("LiveDashboard");
    const bezel = root.getObjectByName("LiveDashboardBezel");
    const original = root.getObjectByName("InteriorSteeringDash");
    const steering = root.getObjectByName("AnimatedSteering");
    const originalPosition = steering.position.clone();
    const mirrors = ["ExteriorMirrorL", "ExteriorMirrorR"].map((name) =>
      root.getObjectByName(name),
    );
    const originalMirrors = mirrors.map((mirror) => ({
      position: mirror.position.clone(),
      quaternion: mirror.quaternion.clone(),
      scale: mirror.scale.clone(),
    }));
    visual.setView("cockpit");
    const inside = {
      screenParent: screen.parent.name,
      sameParent: screen.parent === bezel.parent,
      depth: screen.position.z,
      transparent: screen.material.transparent,
      originalVisible: original.visible,
      cockpitVisible: root.getObjectByName("CockpitInterior").visible,
      steeringX: steering.position.x,
      screenX: screen.parent.position.x,
      mirrors: mirrors.map((mirror) => ({
        position: mirror.position.toArray(),
        independent: mirror.parent === root,
        parts: mirror.children.length,
      })),
    };
    visual.setView("chase");
    const outside = {
      originalVisible: original.visible,
      cockpitVisible: root.getObjectByName("CockpitInterior").visible,
      steeringRestored: steering.position.distanceTo(originalPosition),
      mirrorsRestored: mirrors.every((mirror, index) => {
        const original = originalMirrors[index];
        return (
          mirror.position.equals(original.position) &&
          mirror.quaternion.equals(original.quaternion) &&
          mirror.scale.equals(original.scale)
        );
      }),
    };
    disposeObject(root);
    return { inside, outside };
  });
  expect(result.inside).toMatchObject({
    screenParent: "IntegratedInstrumentCluster",
    sameParent: true,
    depth: -0.012,
    transparent: false,
    originalVisible: false,
    cockpitVisible: true,
  });
  expect(result.inside.steeringX).toBe(result.inside.screenX);
  expect(result.inside.steeringX).toBeGreaterThan(0);
  expect(result.inside.mirrors).toEqual([
    { position: [1.2, 0.23, 0.96], independent: true, parts: 3 },
    { position: [-1.2, 0.23, 0.96], independent: true, parts: 3 },
  ]);
  expect(result.outside).toEqual({
    originalVisible: true,
    cockpitVisible: false,
    steeringRestored: 0,
    mirrorsRestored: true,
  });
});
