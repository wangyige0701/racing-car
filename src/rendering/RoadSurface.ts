import { Vector2 } from "three/webgpu";
import type { EnvironmentAssets } from "./EnvironmentAssets";

/** 本地提供的授权沥青颜色贴图、OpenGL 法线贴图和打包粗糙度贴图。 */
export function roadSurface(assets: EnvironmentAssets) {
  const material = assets.surface("asphalt_02");
  material.normalScale = new Vector2(0.4, 0.4);
  return material;
}
