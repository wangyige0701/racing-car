import { COCKPIT } from "../vehicle/cockpitLayout";
export const CAMERA_MODES = ["chase", "cockpit", "hood", "bumper"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: "追尾视角",
  cockpit: "驾驶舱",
  hood: "引擎盖",
  bumper: "保险杠",
};
// 左座视点位于方向盘后上方，以保留完整仪表台、方向盘和前风挡（+X 为驾驶员左侧）。
export const CAMERA_ANCHORS = {
  cockpit: { ...COCKPIT.eye, lookY: -1.2 },
  hood: { x: 0, y: 0.28, z: 1.44, lookY: 0.14 },
  bumper: { x: 0, y: -0.12, z: 2.28, lookY: 0.02 },
} as const;

export interface CameraSettings {
  fov: number;
  height: number;
  back: number;
  motion: boolean;
}
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  fov: 65,
  height: 0,
  back: 0,
  motion: true,
};
