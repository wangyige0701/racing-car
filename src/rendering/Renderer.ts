import { ACESFilmicToneMapping, PCFShadowMap, WebGPURenderer } from "three/webgpu";
import type { PerspectiveCamera, Scene, WebGPURendererParameters } from "three/webgpu";

/** Three r187 即使向 getFallback 传入 null，仍会安装自身回退逻辑。 */
export class StrictWebGPURenderer extends WebGPURenderer {
  constructor(parameters: Omit<WebGPURendererParameters, "forceWebGL" | "getFallback"> = {}) {
    super(parameters);
    if (!Object.hasOwn(this, "_getFallback")) {
      throw new Error("渲染器接口已改变，无法确认 WebGL 回退已禁用。");
    }
    Object.defineProperty(this, "_getFallback", { value: null, writable: false });
  }
}

export class Graphics {
  private disposed = false;

  private constructor(
    readonly renderer: WebGPURenderer,
    private readonly device: GPUDevice,
    readonly adapterName: string,
  ) {}

  static async create(signal: AbortSignal, onError: (message: string) => void): Promise<Graphics> {
    if (!window.isSecureContext)
      throw new Error("WebGPU 需要安全上下文，请使用 localhost 或 HTTPS。");
    if (!navigator.gpu) throw new Error("当前浏览器未提供 navigator.gpu，无法使用 WebGPU。");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    signal.throwIfAborted();
    if (!adapter) throw new Error("无法获取 GPUAdapter，请检查浏览器硬件加速与显卡驱动。");
    // 若可用，只请求标准核心特性；不需要实验性效果。
    const coreFeature = "core-features-and-limits" as GPUFeatureName;
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has(coreFeature) ? [coreFeature] : [],
    });
    let renderer: WebGPURenderer | undefined;
    try {
      signal.throwIfAborted();
      renderer = new StrictWebGPURenderer({ device, antialias: true, alpha: false });
      renderer.onDeviceLost = (info) => onError(`GPU 设备连接已丢失：${info.message}`);
      renderer.onError = (error: unknown) => {
        const message =
          typeof error === "object" && error && "message" in error
            ? String(error.message)
            : String(error);
        onError(`GPU 渲染错误：${message}`);
      };
      await renderer.init();
      signal.throwIfAborted();
      const backend = renderer.backend as typeof renderer.backend & {
        isWebGPUBackend?: boolean;
        device?: GPUDevice;
      };
      if (backend.isWebGPUBackend !== true || backend.device !== device) {
        throw new Error("实际渲染后端或设备校验失败，已停止启动。");
      }
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFShadowMap;
      renderer.domElement.setAttribute("aria-label", "WebGPU 赛车自由练习场");
      const info = adapter.info;
      const adapterName =
        [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" / ") ||
        "WebGPU 设备（浏览器未公开名称）";
      return new Graphics(renderer, device, adapterName);
    } catch (error) {
      if (renderer) await renderer.dispose().catch(() => undefined);
      device.destroy();
      throw error;
    }
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    this.renderer.render(scene, camera);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.remove();
    try {
      await this.renderer.dispose();
    } finally {
      this.device.destroy();
    }
  }
}
