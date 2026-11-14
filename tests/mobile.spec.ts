import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
]) {
  test(`landscape controls stay visible and support simultaneous fingers ${viewport.width}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/");
    await expect(page.getByTestId("speed")).toBeVisible();
    const controls = page.locator(".touch-controls");
    const box = await controls.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
    const pad = await page.locator(".touch-steering").boundingBox();
    const gas = await controls.locator(".throttle").boundingBox();
    const hand = await controls.locator(".handbrake").boundingBox();
    const cdp = await context.newCDPSession(page);
    const fingers = [
      { x: pad!.x + pad!.width * 0.75, y: pad!.y + 30, id: 1 },
      { x: gas!.x + 30, y: gas!.y + 30, id: 2 },
    ];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers });
    await expect
      .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
      .toBeGreaterThan(8);
    await expect
      .poll(async () => Number(await page.getByTestId("steering").getAttribute("data-value")))
      .toBeLessThan(-0.05);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [...fingers, { x: hand!.x + 30, y: hand!.y + 30, id: 3 }],
    });
    await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "1");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(page.getByTestId("handbrake")).toHaveAttribute("data-value", "0");
    await expect
      .poll(async () => Number(await page.getByTestId("throttle").getAttribute("data-value")))
      .toBeLessThan(0.01);
    await expect
      .poll(async () =>
        Math.abs(Number(await page.getByTestId("steering").getAttribute("data-value"))),
      )
      .toBeLessThan(0.01);
    await page.screenshot({ path: info.outputPath("landscape.png") });
    await page.getByRole("button", { name: "横屏暂停菜单", exact: true }).tap();
    await expect(page.locator(".pause-overlay")).toBeVisible();
    await page.getByLabel("横屏选择赛道").selectOption("city");
    await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.getByTestId("lap-hud")).toContainText("通过起点开始计圈");
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
    await page.screenshot({ path: info.outputPath("landscape-city.png") });
    expect(errors).toEqual([]);
    await context.close();
  });
}
