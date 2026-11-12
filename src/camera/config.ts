import { CAR_ASSET } from "../vehicle/asset";
export const CAMERA_MODES = ["chase", "cockpit", "hood", "bumper"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: "追尾视角",
  cockpit: "驾驶舱",
  hood: "引擎盖",
  bumper: "保险杠",
};
// Left-seat eye above and behind the authored GLB steering wheel (+X is driver left).
export const CAMERA_ANCHORS = {
  cockpit: { x: CAR_ASSET.driverX, y: 0.34, z: 0.36, lookY: -6.4 },
  hood: { x: 0, y: 0.28, z: 1.44, lookY: 0.14 },
  bumper: { x: 0, y: -0.12, z: 2.28, lookY: 0.02 },
} as const;
