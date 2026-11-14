import { test, expect } from "@playwright/test";
import { TRACKS } from "../src/track/catalog";

test("all tracks switch and render without stale canvases or GPU errors", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.goto("/");
  await expect(page.getByTestId("speed")).toBeVisible();
  await page.locator(".quality-control select").selectOption("balanced");
  await page.keyboard.press("c");
  await expect(page.getByTestId("camera-mode")).toHaveText("驾驶舱");
  for (const definition of [...TRACKS.slice(1), TRACKS[0]]) {
    await page.getByLabel("选择赛道", { exact: true }).selectOption(definition.id);
    await expect(page.locator("h1")).toContainText(definition.name);
    await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.getByTestId("backend")).toHaveText("WebGPU");
    await expect(page.getByTestId("camera-mode")).toHaveText("驾驶舱");
    await page.getByLabel("选择赛道", { exact: true }).blur();
    await page.waitForTimeout(800);
    await page.screenshot({ path: info.outputPath(`${definition.id}-cockpit.png`), scale: "css" });
    await page.keyboard.down("w");
    await expect(page.getByTestId("lap-hud")).toContainText("下一点 CP 1");
    await page.keyboard.up("w");
    await page.keyboard.press("r");
    await expect(page.getByTestId("lap-hud")).toContainText("本圈无效");
  }
  expect(errors).toEqual([]);
});
