import { test, expect } from "@playwright/test";
test("all quality tiers render and can be restored without GPU errors", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1000, height: 740 });
  await page.goto("/");
  await expect(page.getByTestId("speed")).toBeVisible();
  for (const quality of ["economy", "balanced", "high"]) {
    await page.locator(".quality-control select").selectOption(quality);
    const before = Number((await page.getByTestId("frames").textContent())!.replaceAll(",", ""));
    await expect
      .poll(async () =>
        Number((await page.getByTestId("frames").textContent())!.replaceAll(",", "")),
      )
      .toBeGreaterThan(before + 10);
    await page.screenshot({ path: info.outputPath(`${quality}.png`), scale: "css" });
  }
  expect(errors).toEqual([]);
});
