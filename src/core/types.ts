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
  bodyHeight: number;
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
    bodyHeight: 4,
  };
}
