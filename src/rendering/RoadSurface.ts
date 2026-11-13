import {
  DataTexture,
  MeshStandardNodeMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  LinearFilter,
  LinearMipmapLinearFilter,
} from "three/webgpu";

/** Deterministic, locally generated asphalt maps. No external texture service. */
export function roadSurface(): MeshStandardNodeMaterial {
  const size = 256,
    diffuse = new Uint8Array(size * size * 4),
    normals = new Uint8Array(size * size * 4);
  let seed = 9541;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = seed / 4294967296;
    const shade = 50 + n * 26;
    diffuse.set([shade, shade + 2, shade + 4, 255], i * 4);
    normals.set([120 + n * 16, 120 + ((seed >>> 12) % 16), 255, 255], i * 4);
  }
  const map = new DataTexture(diffuse, size, size),
    normalMap = new DataTexture(normals, size, size);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.needsUpdate = true;
    t.anisotropy = 4;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
  }
  map.colorSpace = SRGBColorSpace;
  return new MeshStandardNodeMaterial({
    map,
    normalMap,
    normalScale: new Vector2(0.25, 0.25),
    roughness: 0.88,
  });
}
