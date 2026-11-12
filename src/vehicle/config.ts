/** SI units. Car local coordinates: +Z forward, +Y up, +X right. */
export const VEHICLE = {
  name: "APEX GT / P01",
  mass: 1180,
  centerOfMass: { x: 0, y: -0.28, z: 0 },
  inertia: { x: 1800, y: 2100, z: 750 },
  wheelRadius: 0.34,
  wheelConnections: [
    { x: -0.94, y: 0, z: 1.32 },
    { x: 0.94, y: 0, z: 1.32 },
    { x: -0.94, y: 0, z: -1.32 },
    { x: 0.94, y: 0, z: -1.32 },
  ],
  suspension: {
    rest: 0.32,
    travel: 0.2,
    stiffness: 38,
    compression: 4.4,
    relaxation: 5.8,
    maxForce: 12000,
  },
  tireFriction: 2.3,
  sideFriction: 1.1,
  maxTorque: 410,
  gears: [3.1, 2.1, 1.5, 1.15, 0.9],
  gearSpeeds: [0, 14, 25, 37, 49],
  finalDrive: 3.4,
  efficiency: 0.88,
  maxSpeed: 58,
  reverseSpeed: 9,
  maxBrakeForce: 14000,
  maxSteer: 0.52,
  steeringRate: 4.5,
  throttleRate: 7,
  directionDelay: 0.25,
} as const;
export interface DriverInput {
  throttle: number;
  brake: number;
  steer: number;
}
export const emptyInput = (): DriverInput => ({ throttle: 0, brake: 0, steer: 0 });
