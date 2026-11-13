import { FixedStep } from "./FixedStep";
import { initialDiagnostics } from "./types";
import type { Diagnostics } from "./types";
import { Graphics } from "../rendering/Renderer";
import { DrivingScene } from "../rendering/DrivingScene";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { VehiclePhysics } from "../vehicle/VehiclePhysics";
import { VehicleVisual } from "../vehicle/VehicleVisual";
import { VehicleAudio } from "../audio/VehicleAudio";
import { Track } from "../track/Track";
import { InputManager } from "../input/InputManager";
import type { TouchControl } from "../input/InputManager";
import { emptyInput } from "../vehicle/config";

/** Runtime state stays outside Vue; HUD snapshots are published at 10 Hz. */
export class GameApplication {
  private graphics?: Graphics;
  private scene?: DrivingScene;
  private physics?: PhysicsWorld;
  private vehicle?: VehiclePhysics;
  private input?: InputManager;
  private audio?: VehicleAudio;
  private readonly idleInput = emptyInput();
  private elapsed = 0;
  private observer?: ResizeObserver;
  private boot?: AbortController;
  private readonly clock = new FixedStep();
  private diagnostics = initialDiagnostics();
  private frameId = 0;
  private previousTime = 0;
  private lastPublish = 0;
  private sampledFrames = 0;
  private pixelRatioCap = 2;
  private disposed = false;
  private releasing: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: HTMLElement,
    private readonly publish: (snapshot: Diagnostics) => void,
  ) {}

  async start(): Promise<void> {
    if (this.disposed) return;
    const controller = new AbortController();
    this.boot = controller;
    const { signal } = controller;
    const started = performance.now();
    this.diagnostics = initialDiagnostics();
    this.emit();
    try {
      const graphics = await Graphics.create(signal, this.fail);
      if (signal.aborted) {
        await graphics.dispose();
        return;
      }
      this.graphics = graphics;
      this.diagnostics.backend = "WebGPU";
      this.diagnostics.adapter = graphics.adapterName;
      this.diagnostics.message = "正在初始化 Rapier 物理世界";
      this.emit();
      const track = new Track();
      const physics = await PhysicsWorld.create(track);
      if (signal.aborted) {
        physics.dispose();
        return;
      }
      this.physics = physics;
      this.vehicle = new VehiclePhysics(physics.world, track);
      this.diagnostics.physicsReady = true;
      this.diagnostics.trackLength = track.length;
      this.diagnostics.mapPoints = track.samples.map((s) => `${s.x},${-s.z}`).join(" ");
      this.elapsed = 0;
      this.diagnostics.message = "正在加载 GLB 赛车与左舵驾驶舱";
      this.emit();
      const visual = await VehicleVisual.load(signal);
      this.scene = new DrivingScene(track, visual);
      this.scene.update(this.vehicle, 1, 0, physics, true);
      this.host.append(graphics.renderer.domElement);
      this.resize();
      this.diagnostics.message = "正在编译 TSL 材质并提交首帧";
      this.emit();
      await graphics.renderer.compileAsync(this.scene.scene, this.scene.camera);
      signal.throwIfAborted();
      graphics.render(this.scene.scene, this.scene.camera);
      this.diagnostics.frames = 1;
      this.diagnostics.phase = "running";
      this.input = new InputManager(
        () => this.togglePause(),
        () => this.resetVehicle(),
        this.pauseForFocus,
        () => this.cycleCamera(),
      );
      this.audio = new VehicleAudio();
      this.audio.setActive(true);
      this.diagnostics.message = "WebGPU 后端与设备已验证";
      this.diagnostics.loadMs = performance.now() - started;
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.host);
      document.addEventListener("visibilitychange", this.visibilityChanged);
      this.previousTime = this.lastPublish = performance.now();
      this.sampledFrames = 1;
      this.emit();
      if (!document.hidden) this.frameId = requestAnimationFrame(this.frame);
    } catch (error) {
      if (!signal.aborted) this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.graphics || !this.scene || !this.physics || !this.vehicle || this.disposed) return;
    try {
      const delta = (now - this.previousTime) / 1000;
      this.previousTime = now;
      this.input?.poll();
      if (this.diagnostics.phase === "running") {
        const alpha = this.clock.advance(delta, this.simulate);
        this.scene.update(this.vehicle, alpha, delta, this.physics);
      } else this.scene.updateCamera(this.vehicle, delta, this.physics);
      this.audio?.update(
        this.vehicle,
        this.physics.collisionCount,
        this.scene.cameras.mode === "cockpit",
      );
      if (
        Math.min(window.devicePixelRatio || 1, this.pixelRatioCap) !== this.diagnostics.pixelRatio
      )
        this.resize();
      const renderStart = performance.now();
      this.graphics.render(this.scene.scene, this.scene.camera);
      this.diagnostics.renderSubmitMs = performance.now() - renderStart;
      this.diagnostics.frames++;
      if (now - this.lastPublish >= 100) {
        this.diagnostics.fps = Math.round(
          ((this.diagnostics.frames - this.sampledFrames) * 1000) / (now - this.lastPublish),
        );
        this.sampledFrames = this.diagnostics.frames;
        this.lastPublish = now;
        this.emit();
      }
      this.frameId = requestAnimationFrame(this.frame);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  };

  private readonly simulate = (dt: number): void => {
    if (!this.physics || !this.vehicle) return;
    const start = performance.now();
    this.vehicle.beforeStep(dt, this.input?.read() ?? this.idleInput);
    this.physics.step(dt);
    this.vehicle.afterStep(dt);
    this.elapsed += dt;
    this.diagnostics.physicsMs = performance.now() - start;
    this.diagnostics.physicsSteps++;
  };

  private readonly resize = (): void => {
    if (!this.graphics || !this.scene) return;
    const width = Math.max(1, Math.round(this.host.clientWidth));
    const height = Math.max(1, Math.round(this.host.clientHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    this.graphics.renderer.setPixelRatio(pixelRatio);
    this.graphics.renderer.setSize(width, height, false);
    this.scene.resize(width, height);
    Object.assign(this.diagnostics, { width, height, pixelRatio });
    this.emit();
  };

  private readonly visibilityChanged = (): void => {
    if (document.hidden) this.pauseForFocus();
    cancelAnimationFrame(this.frameId);
    this.clock.reset();
    this.previousTime = this.lastPublish = performance.now();
    this.sampledFrames = this.diagnostics.frames;
    if (!document.hidden && ["running", "paused"].includes(this.diagnostics.phase))
      this.frameId = requestAnimationFrame(this.frame);
  };

  setQuality(quality: "high" | "balanced"): void {
    this.pixelRatioCap = quality === "high" ? 2 : 1;
    this.resize();
  }

  togglePause(): void {
    if (!["running", "paused"].includes(this.diagnostics.phase)) return;
    this.diagnostics.phase = this.diagnostics.phase === "running" ? "paused" : "running";
    this.input?.clear();
    if (this.input) this.input.enabled = this.diagnostics.phase === "running";
    this.audio?.setActive(this.diagnostics.phase === "running");
    this.clock.reset();
    this.previousTime = performance.now();
    this.emit();
  }

  private readonly pauseForFocus = (): void => {
    this.input?.clear();
    if (this.diagnostics.phase === "running") this.togglePause();
  };

  touch(control: TouchControl, pressed: boolean): void {
    this.input?.setTouch(control, pressed);
  }

  touchSteering(value: number): void {
    this.input?.setTouchSteering(value);
  }

  cycleCamera(): void {
    if (!this.scene || !["running", "paused"].includes(this.diagnostics.phase)) return;
    this.scene.cameras.cycle();
    this.emit();
  }

  toggleAudio(): void {
    this.audio?.toggleMuted();
    this.emit();
  }

  resetVehicle(): void {
    if (!this.physics || !this.scene || !this.vehicle) return;
    this.input?.clear();
    this.vehicle.reset();
    this.physics.collisionCount = 0;
    this.audio?.reset();
    this.elapsed = 0;
    this.scene.update(this.vehicle, 1, 0, this.physics, true);
    this.clock.reset();
    this.emit();
  }

  async restart(): Promise<void> {
    if (this.disposed || this.diagnostics.phase !== "error") return;
    this.diagnostics.phase = "starting";
    this.emit();
    await this.releasing;
    await this.start();
  }

  private readonly fail = (message: string): void => {
    if (this.disposed || this.boot?.signal.aborted) return;
    this.diagnostics.phase = "error";
    this.diagnostics.message = message;
    this.diagnostics.physicsReady = false;
    this.diagnostics.fps = 0;
    this.emit();
    this.release();
  };

  private emit(): void {
    if (this.vehicle) {
      const v = this.vehicle,
        q = v.rotation;
      Object.assign(this.diagnostics, {
        speedKmh: v.speed * 3.6,
        rpm: v.rpm,
        gear: v.gear,
        throttle: v.throttle,
        brake: v.brake,
        steer: v.steer,
        groundedWheels: v.groundedWheels,
        distance: v.distance,
        elapsed: this.elapsed,
        mapX: v.position.x,
        mapY: -v.position.z,
        heading:
          (Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180) /
          Math.PI,
        collisions: this.physics?.collisionCount ?? 0,
        inputSource: this.input?.source ?? "键盘",
        handbrake: v.handbrake,
        rearGrip: v.drift.rearGrip,
        slipAngle: (v.drift.slipAngle * 180) / Math.PI,
        drifting: v.drift.active,
        driftTime: v.drift.duration,
        cameraMode: this.scene?.cameras.mode ?? "chase",
        smokeParticles: this.scene?.smoke.count ?? 0,
        audioStatus: this.audio?.status ?? "locked",
        audioMuted: this.audio?.muted ?? false,
      });
    }
    if (!this.disposed) this.publish({ ...this.diagnostics });
  }

  private release(): void {
    this.boot?.abort();
    cancelAnimationFrame(this.frameId);
    this.observer?.disconnect();
    this.observer = undefined;
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.clock.reset();
    this.input?.dispose();
    this.input = undefined;
    this.audio?.dispose();
    this.audio = undefined;
    this.vehicle = undefined;
    this.physics?.dispose();
    this.physics = undefined;
    this.scene?.dispose();
    this.scene = undefined;
    const graphics = this.graphics;
    this.graphics = undefined;
    this.releasing =
      graphics?.dispose().catch((error: unknown) => {
        console.error("WebGPU 资源释放失败", error);
      }) ?? this.releasing;
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.release();
    }
  }
}
