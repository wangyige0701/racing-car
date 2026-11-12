import { DirectionalLight, InstancedMesh, Mesh, Texture } from "three/webgpu";
import type { BufferGeometry, Material, Object3D } from "three/webgpu";

/** Shared GLB textures/materials are released once, including PBR maps and ImageBitmaps. */
export function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof Texture) textures.add(value);
      }
    }
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof DirectionalLight) object.shadow.dispose();
  });
  const images = new Set<unknown>();
  textures.forEach((texture) => {
    const image = texture.source.data;
    if (!images.has(image) && typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
      image.close();
    images.add(image);
    texture.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  root.clear();
}
