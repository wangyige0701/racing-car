/** SI units. Right-handed frame: +Z forward, +Y up, +X driver left. Input +steer means right. */
export const VEHICLE = {
  name: "APEX / CAR CONCEPT",
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
    antiRollStiffness: 6500,
    antiRollMaxForce: 1800,
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
  handbrakeForce: 9500,
  groundYawDamping: 1.7,
  uprightStiffness: 11000,
  uprightDamping: 2200,
  countersteerRate: 7,
  countersteerReserve: 0.3,
  driveRecoveryRate: 6,
  drift: {
    countersteerAssist: 1,
    targetSlip: 0.85,
    slipRecovery: 2.5,
    yawResponse: 18,
    maxAssistTorque: 25000,
    rearGripMinimum: 0.48,
    releaseRate: 2.6,
    engageRate: 14,
    minSpeed: 5,
    enterAngle: (9 * Math.PI) / 180,
    exitAngle: (5 * Math.PI) / 180,
  },
  maxSteer: 0.52,
  steeringRate: 4.5,
  throttleRate: 7,
  directionDelay: 0.25,
} as const;
export interface DriverInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: number;
}
export const emptyInput = (): DriverInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0 });
