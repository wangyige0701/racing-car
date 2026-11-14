import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const outputRoot = "public/assets/environment";
const sourceRoot =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? ".asset-cache/environment";
const sources = JSON.parse(
  (await readFile(`${outputRoot}/sources.json`, "utf8")).replace(/^\uFEFF/, ""),
);
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const reports = [];
for (const source of sources) {
  const directory = join(sourceRoot, source.id);
  const files = { [`${source.id}_1k.gltf`]: source.source, ...source.source.include };
  for (const [name, file] of Object.entries(files)) {
    if (process.argv.includes("--download")) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Download failed: ${file.url} (${response.status})`);
      const target = join(directory, name);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, new Uint8Array(await response.arrayBuffer()));
    }
    const bytes = await readFile(join(directory, name));
    if (createHash("md5").update(bytes).digest("hex") !== file.md5)
      throw new Error(`Source checksum mismatch: ${source.id}/${name}`);
  }
  for (const lod of ["near", "far"]) {
    const document = await io.read(join(directory, `${source.id}_1k.gltf`));
    const scene = document.getRoot().getDefaultScene();
    // 集合模型会并排包含多个样本，只保留一份完整样本。
    const nodes = scene.listChildren();
    for (const node of nodes.slice(1)) node.dispose();
    nodes[0].setTranslation([0, 0, 0]);
    await document.transform(
      prune(),
      dedup(),
      weld(),
      simplify({
        simplifier:
          source.id === "boulder_01"
            ? {
                ...MeshoptSimplifier,
                simplify: (...args) => {
                  args[5] = [...args[5], "Permissive"];
                  return MeshoptSimplifier.simplify(...args);
                },
              }
            : MeshoptSimplifier,
        ratio: lod === "near" ? 0.15 : 0.035,
        error: lod === "near" ? 0.006 : 0.025,
      }),
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        resize: lod === "near" ? [1024, 1024] : [256, 256],
        quality: 80,
      }),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    const bytes = await io.writeBinary(document);
    const name = `${source.id}-${lod}.glb`;
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, name), bytes);
    const triangles = document
      .getRoot()
      .listMeshes()
      .reduce(
        (sum, mesh) =>
          sum +
          mesh
            .listPrimitives()
            .reduce(
              (n, p) =>
                n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3,
              0,
            ),
        0,
      );
    const report = {
      name,
      bytes: bytes.length,
      triangles,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    reports.push(report);
    console.log(report);
  }
}
await writeFile(join(outputRoot, "manifest.json"), JSON.stringify(reports, null, 2) + "\n");
const surfaces = JSON.parse(
  (await readFile(`${outputRoot}/surface-sources.json`, "utf8")).replace(/^\uFEFF/, ""),
);
const surfaceReports = [];
for (const surface of surfaces) {
  for (const [channel, file] of Object.entries(surface.files)) {
    const sourcePath = join(sourceRoot, surface.id, `${channel}.jpg`);
    if (process.argv.includes("--download")) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Download failed: ${file.url}`);
      await mkdir(join(sourcePath, ".."), { recursive: true });
      await writeFile(sourcePath, new Uint8Array(await response.arrayBuffer()));
    }
    const source = await readFile(sourcePath);
    if (createHash("md5").update(source).digest("hex") !== file.md5)
      throw new Error(`Source checksum mismatch: ${sourcePath}`);
    const size = channel === "Diffuse" ? 1024 : channel === "nor_gl" ? 768 : 512;
    const bytes = await sharp(source).resize(size, size).webp({ quality: 85 }).toBuffer();
    const name = `${surface.id}-${channel}.webp`;
    await writeFile(join(outputRoot, name), bytes);
    surfaceReports.push({
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
await writeFile(
  join(outputRoot, "surface-manifest.json"),
  JSON.stringify(surfaceReports, null, 2) + "\n",
);
