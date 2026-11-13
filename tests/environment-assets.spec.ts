import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

test("environment assets match pinned hashes and near/far geometry budgets", async () => {
  await MeshoptDecoder.ready;
  const root = "public/assets/environment/";
  const models = JSON.parse(await readFile(root + "manifest.json", "utf8"));
  const surfaces = JSON.parse(await readFile(root + "surface-manifest.json", "utf8"));
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  let bytes = 0;
  for (const item of [...models, ...surfaces]) {
    const buffer = await readFile(root + item.name);
    expect(createHash("sha256").update(buffer).digest("hex")).toBe(item.sha256);
    expect(buffer.length).toBe(item.bytes);
    bytes += buffer.length;
    if (!item.name.endsWith(".glb")) continue;
    const document = await io.readBinary(buffer);
    expect(document.getRoot().listMeshes().length).toBeGreaterThan(0);
    expect(
      document
        .getRoot()
        .listTextures()
        .every((texture) => texture.getImage()!.length > 0),
    ).toBe(true);
    expect(item.triangles).toBeLessThan(item.name.includes("-far") ? 5000 : 20000);
  }
  expect(bytes).toBeLessThan(5_000_000);
});

test("a failed environment download is visible and retries cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/environment/asphalt_02-Diffuse.webp", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("场景材质加载失败");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.unroute("**/assets/environment/asphalt_02-Diffuse.webp");
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});
