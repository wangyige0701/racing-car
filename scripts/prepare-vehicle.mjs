import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

// 源地址、版权和许可随发布资源一并记录。
// 下载文件保留在 public/ 之外；本脚本绝不修改源文件。
const source = process.argv[2] ?? ".asset-cache/car-concept-source.glb";
const bytes = await readFile(source);
const expected = "c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b";
if (createHash("sha256").update(bytes).digest("hex") !== expected) {
  throw new Error("Unexpected Car Concept source hash; review the asset before rebuilding.");
}
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
});
const document = await io.readBinary(bytes);
// 原始概念车采用中置转向。将整套控制总成移至左座，
// 同时保留原有方向盘、仪表台、转向柱和踏板。
const shiftNodes = new Set([
  "InteriorSteeringBase",
  "InteriorSteeringCylinder",
  "InteriorSteeringDash",
  "InteriorSteeringDashColumn",
  "InteriorSteeringHandleL",
  "InteriorSteeringHandleR",
  "InteriorPedalAccel",
  "InteriorPedalAccelArm",
  "InteriorPedalBrake",
  "InteriorPedalBrakeArm",
]);
for (const node of document.getRoot().listNodes()) {
  if (shiftNodes.has(node.getName())) {
    const [x, y, z] = node.getTranslation();
    node.setTranslation([x + 0.42, y, z]);
  }
}
// 仅发布一种涂装，同时保留驾驶动画需要的节点边界。
for (const extension of document.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === "KHR_materials_variants") extension.dispose();
}
await document.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.7, error: 0.0004 }),
  prune({ keepLeaves: true }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
const output = await io.writeBinary(document);
await writeFile("public/assets/vehicles/car-concept/car.glb", output);
const triangles = document
  .getRoot()
  .listMeshes()
  .reduce(
    (total, mesh) =>
      total +
      mesh
        .listPrimitives()
        .reduce(
          (n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3,
          0,
        ),
    0,
  );
const report = {
  sourceSha256: expected,
  outputSha256: createHash("sha256").update(output).digest("hex"),
  sourceBytes: bytes.length,
  bytes: output.length,
  triangles,
  leftHandDriveOffsetMetres: 0.42,
};
await writeFile(
  "public/assets/vehicles/car-concept/asset.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
