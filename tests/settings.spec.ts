import { expect, test } from "@playwright/test";

test("player settings persist locally and invalid stored values fall back safely", async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  const result = await page.evaluate(async (modulePath) => {
    const { loadGameSettings, saveGameSettings } = await import(modulePath);
    localStorage.removeItem("apex-racing-settings-v1");
    saveGameSettings({
      audioMuted: true,
      audioVolume: 0.6,
      quality: "economy",
      steeringSensitivity: 1.25,
      cameraMode: "bumper",
      cameraSettings: { fov: 72, height: 0.04, back: -0.03, motion: false },
    });
    const saved = loadGameSettings();
    localStorage.setItem(
      "apex-racing-settings-v1",
      JSON.stringify({ audioVolume: 4, quality: "invalid", cameraSettings: { fov: -1 } }),
    );
    return { saved, invalid: loadGameSettings() };
  }, "/src/core/settings.ts");
  expect(result.saved).toEqual({
    audioMuted: true,
    audioVolume: 0.6,
    quality: "economy",
    steeringSensitivity: 1.25,
    cameraMode: "bumper",
    cameraSettings: { fov: 72, height: 0.04, back: -0.03, motion: false },
  });
  expect(result.invalid).toMatchObject({
    audioVolume: 1,
    quality: "high",
    steeringSensitivity: 1,
    cameraMode: "chase",
    cameraSettings: { fov: 55, height: 0, back: 0, motion: true },
  });
});
