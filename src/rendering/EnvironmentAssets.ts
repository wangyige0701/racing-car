import {
  Box3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Vector3,
  Texture,
  RepeatWrapping,
  SRGBColorSpace,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { disposeObject } from "./dispose";

export const ENVIRONMENT_MODELS = [
  "boulder_01",
  "pine_sapling_small",
  "wild_rooibos_bush",
  "street_lamp_01",
] as const;
export type EnvironmentModel = (typeof ENVIRONMENT_MODELS)[number];
export type ModelDetail = "near" | "far";

/** Local, licensed assets; a failed download is reported and can be retried. */
export class EnvironmentAssets {
  private readonly models = new Map<string, Group>();
  private readonly textures = new Map<string, Texture>();
  private readonly usedSurfaces = new Set<string>();
  static async load(signal: AbortSignal): Promise<EnvironmentAssets> {
    const assets = new EnvironmentAssets();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const loads = ENVIRONMENT_MODELS.flatMap((id) =>
      ["near", "far"].map(async (detail) => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}assets/environment/${id}-${detail}.glb`,
          { signal },
        );
        if (!response.ok)
          throw new Error(`场景模型加载失败：${id}（${response.status}），请重试。`);
        const buffer = await response.arrayBuffer();
        signal.throwIfAborted();
        const { scene } = await loader.parseAsync(buffer, "");
        assets.models.set(`${id}-${detail}`, scene);
      }),
    );
    loads.push(
      ...["asphalt_02", "forest_ground_04", "concrete_wall_006"].flatMap((id) =>
        ["Diffuse", "nor_gl", "arm"].map(async (channel) => {
          const response = await fetch(
            `${import.meta.env.BASE_URL}assets/environment/${id}-${channel}.webp`,
            { signal },
          );
          if (!response.ok)
            throw new Error(`场景材质加载失败：${id}（${response.status}），请重试。`);
          const bitmap = await createImageBitmap(await response.blob(), {
            imageOrientation: "flipY",
            colorSpaceConversion: "none",
          });
          const texture = new Texture(bitmap);
          texture.wrapS = texture.wrapT = RepeatWrapping;
          texture.anisotropy = 4;
          if (channel === "Diffuse") texture.colorSpace = SRGBColorSpace;
          texture.needsUpdate = true;
          assets.textures.set(`${id}-${channel}`, texture);
        }),
      ),
    );
    const results = await Promise.allSettled(loads);
    const failure = results.find((result) => result.status === "rejected");
    if (failure || signal.aborted) {
      assets.dispose();
      signal.throwIfAborted();
      throw (failure as PromiseRejectedResult).reason;
    }
    return assets;
  }
  surface(id: "asphalt_02" | "forest_ground_04" | "concrete_wall_006"): MeshStandardNodeMaterial {
    this.usedSurfaces.add(id);
    return new MeshStandardNodeMaterial({
      map: this.textures.get(`${id}-Diffuse`),
      normalMap: this.textures.get(`${id}-nor_gl`),
      roughnessMap: this.textures.get(`${id}-arm`),
      roughness: 1,
    });
  }
  createBatch(id: EnvironmentModel, detail: ModelDetail, capacity: number): InstancedMesh[] {
    const model = this.models.get(`${id}-${detail}`)!;
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    const height = Math.max(0.01, box.max.y - box.min.y);
    const normalize = new Matrix4()
      .makeScale(1 / height, 1 / height, 1 / height)
      .multiply(new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
    const meshes: InstancedMesh[] = [];
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry
        .clone()
        .applyMatrix4(new Matrix4().multiplyMatrices(normalize, object.matrixWorld));
      const mesh = new InstancedMesh(geometry, object.material, capacity);
      mesh.name = `${id}-${detail}`;
      mesh.castShadow = detail === "near";
      mesh.receiveShadow = true;
      mesh.count = 0;
      meshes.push(mesh);
    });
    return meshes;
  }
  /** Source geometry is separate from the baked instances; materials are shared. */
  disposeSourceGeometry(): void {
    for (const model of this.models.values())
      model.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
    this.models.clear();
    for (const [name, texture] of this.textures) {
      if ([...this.usedSurfaces].some((id) => name.startsWith(`${id}-`))) continue;
      (texture.source.data as ImageBitmap).close();
      texture.dispose();
    }
    this.textures.clear();
  }
  dispose(): void {
    for (const model of this.models.values()) disposeObject(model);
    this.models.clear();
    for (const texture of this.textures.values()) {
      (texture.source.data as ImageBitmap).close();
      texture.dispose();
    }
    this.textures.clear();
  }
}
