import { Vector2 } from "three/webgpu";
import type { EnvironmentAssets } from "./EnvironmentAssets";

/** Licensed asphalt colour, OpenGL normal and packed roughness, served locally. */
export function roadSurface(assets: EnvironmentAssets) {
  const material = assets.surface("asphalt_02");
  material.normalScale = new Vector2(0.4, 0.4);
  return material;
}
