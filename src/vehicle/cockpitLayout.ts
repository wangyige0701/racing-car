import { CAR_ASSET } from "./asset";

/** 驾驶舱各部件统一使用底盘米制坐标；+X 为左座，+Z 为车头。 */
export const COCKPIT = {
  eye: { x: CAR_ASSET.driverX, y: 0.44, z: -0.16 },
  steering: { x: CAR_ASSET.driverX, y: 0.015, z: 0.5 },
  instrument: { x: CAR_ASSET.driverX, y: 0.17, z: 0.82, tilt: 0.22 },
  mirror: { x: 1.2, y: 0.23, z: 0.96 },
  windshield: {
    lower: { x: 1.02, y: 0.16, z: 1.18 },
    upper: { x: 0.87, y: 0.94, z: 0.1 },
  },
} as const;
