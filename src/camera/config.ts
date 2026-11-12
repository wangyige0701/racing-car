export const CAMERA_MODES = ["chase", "cockpit", "hood", "bumper"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: "追尾视角",
  cockpit: "驾驶舱",
  hood: "引擎盖",
  bumper: "保险杠",
};
// Chassis-local eye positions in metres, aligned with the prototype visual model.
export const CAMERA_ANCHORS = {
  cockpit: { x: -0.32, y: 0.78, z: -0.12, lookY: 0.69 },
  hood: { x: 0, y: 0.55, z: 1.35, lookY: 0.49 },
  bumper: { x: 0, y: -0.02, z: 2.23, lookY: 0.06 },
} as const;
