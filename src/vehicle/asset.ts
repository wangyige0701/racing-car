/** 运行时资源由本地提供；详见 public/assets/vehicles/car-concept/CREDITS.md。 */
export const CAR_ASSET = {
  url: `${import.meta.env?.BASE_URL ?? "/"}assets/vehicles/car-concept/car.glb`,
  name: "APEX / CAR CONCEPT",
  scale: 2.64 / 2.799,
  offsetY: -0.32 - 0.383759 * (2.64 / 2.799),
  offsetZ: -0.0858 * (2.64 / 2.799),
  // 此右手坐标系中 +Z 向前，驾驶员左侧为 +X。
  driverX: 0.42 * (2.64 / 2.799),
  wheels: ["WheelFrontR", "WheelFrontL", "WheelRearR", "WheelRearL"],
} as const;
