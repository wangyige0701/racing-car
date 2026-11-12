import type { CameraMode } from "../camera/config";
export type BootPhase = "starting" | "running" | "paused" | "error";

export interface Diagnostics {
  phase: BootPhase;
  message: string;
  backend: string;
  adapter: string;
  physicsReady: boolean;
  frames: number;
  physicsSteps: number;
  fps: number;
  physicsMs: number;
  renderSubmitMs: number;
  loadMs: number;
  width: number;
  height: number;
  pixelRatio: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  steer: number;
  groundedWheels: number;
  distance: number;
  elapsed: number;
  collisions: number;
  trackLength: number;
  mapPoints: string;
  mapX: number;
  mapY: number;
  heading: number;
  inputSource: string;
  handbrake: number;
  rearGrip: number;
  slipAngle: number;
  drifting: boolean;
  driftTime: number;
  cameraMode: CameraMode;
}

export function initialDiagnostics(): Diagnostics {
  return {
    phase: "starting",
    message: "正在请求 GPU 设备",
    backend: "等待验证",
    adapter: "等待适配器",
    physicsReady: false,
    frames: 0,
    physicsSteps: 0,
    fps: 0,
    physicsMs: 0,
    renderSubmitMs: 0,
    loadMs: 0,
    width: 0,
    height: 0,
    pixelRatio: 1,
    speedKmh: 0,
    rpm: 950,
    gear: 1,
    throttle: 0,
    brake: 0,
    steer: 0,
    groundedWheels: 0,
    distance: 0,
    elapsed: 0,
    collisions: 0,
    trackLength: 0,
    mapPoints: "",
    mapX: 0,
    mapY: 0,
    heading: 0,
    inputSource: "键盘",
    handbrake: 0,
    rearGrip: 1,
    slipAngle: 0,
    drifting: false,
    driftTime: 0,
    cameraMode: "chase",
  };
}
