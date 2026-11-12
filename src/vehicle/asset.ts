/** Runtime assets are served locally; see public/assets/vehicles/car-concept/CREDITS.md. */
export const CAR_ASSET = {
  url: `${import.meta.env?.BASE_URL ?? "/"}assets/vehicles/car-concept/car.glb`,
  name: "APEX / CAR CONCEPT",
  scale: 2.64 / 2.799,
  offsetY: -0.32 - 0.383759 * (2.64 / 2.799),
  offsetZ: -0.0858 * (2.64 / 2.799),
  // +Z is forward in this right-handed coordinate system: driver left is +X.
  driverX: 0.42 * (2.64 / 2.799),
  wheels: ["WheelFrontR", "WheelFrontL", "WheelRearR", "WheelRearL"],
} as const;
