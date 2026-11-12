import type { VehiclePhysics } from "../vehicle/VehiclePhysics";

/** Original synthesized audio. No downloaded samples or automatic playback. */
export class VehicleAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private tireGain?: GainNode;
  private windGain?: GainNode;
  private impactGain?: GainNode;
  private filter?: BiquadFilterNode;
  private readonly oscillators: OscillatorNode[] = [];
  private noise?: AudioBufferSourceNode;
  private nodes: AudioNode[] = [];
  private active = false;
  private disposed = false;
  private lastCollision = 0;
  private lastImpact = -1;
  muted = false;
  status: "locked" | "running" | "suspended" | "unavailable" = "locked";

  constructor() {
    window.addEventListener("keydown", this.gesture);
    window.addEventListener("pointerdown", this.gesture);
  }

  private readonly gesture = (event: Event): void => {
    if (event.isTrusted && !this.muted && !this.disposed) void this.unlock();
  };

  private async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) this.create();
      if (this.context?.state === "suspended") await this.context.resume();
      if (!this.disposed) this.status = this.context?.state === "running" ? "running" : "suspended";
    } catch {
      this.releaseResources();
      this.status = "unavailable";
    }
  }

  private create(): void {
    const ctx = new AudioContext();
    this.context = ctx;
    ctx.onstatechange = () => {
      if (!this.disposed) this.status = ctx.state === "running" ? "running" : "suspended";
    };
    const gain = (value = 0) => {
      const n = ctx.createGain();
      n.gain.value = value;
      this.nodes.push(n);
      return n;
    };
    this.master = gain(0);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    this.nodes.push(compressor);
    this.master.connect(compressor).connect(ctx.destination);
    this.engineGain = gain();
    this.engineGain.connect(this.master);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 800;
    this.nodes.push(this.filter);
    this.filter.connect(this.engineGain);
    // A four-stroke V8 firing fundamental and quieter harmonics track RPM.
    for (let i = 0; i < 3; i++) {
      const oscillator = ctx.createOscillator();
      oscillator.type = i === 0 ? "sawtooth" : "triangle";
      const level = gain([0.28, 0.11, 0.045][i]);
      oscillator.connect(level).connect(this.filter);
      oscillator.start();
      this.oscillators.push(oscillator);
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 1207;
    for (let i = 0; i < channel.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      channel[i] = seed / 2147483648 - 1;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    const branch = (type: BiquadFilterType, frequency: number) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      const output = gain();
      this.nodes.push(filter);
      this.noise!.connect(filter).connect(output).connect(this.master!);
      return output;
    };
    this.tireGain = branch("bandpass", 1900);
    this.windGain = branch("lowpass", 450);
    this.impactGain = branch("lowpass", 180);
    this.noise.start();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.master?.gain.setTargetAtTime(
      active && !this.muted ? 0.42 : 0,
      this.context!.currentTime,
      0.025,
    );
  }

  toggleMuted(): void {
    this.muted = !this.muted;
    this.setActive(this.active);
    if (!this.muted) void this.unlock();
  }

  update(vehicle: VehiclePhysics, collisions: number, cockpit: boolean): void {
    const ctx = this.context;
    const newCollision = collisions > this.lastCollision;
    this.lastCollision = collisions;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    this.master!.gain.setTargetAtTime(this.active && !this.muted ? 0.42 : 0, now, 0.025);
    this.oscillators.forEach((oscillator, i) =>
      oscillator.frequency.setTargetAtTime((vehicle.rpm / 60) * 4 * (i + 1), now, 0.08),
    );
    this.engineGain!.gain.setTargetAtTime(
      (0.16 + vehicle.throttle * 0.45) * (cockpit ? 0.65 : 1),
      now,
      0.08,
    );
    this.filter!.frequency.setTargetAtTime(
      (500 + vehicle.throttle * 1300 + vehicle.rpm * 0.12) * (cockpit ? 0.65 : 1),
      now,
      0.1,
    );
    const tire =
      vehicle.groundedWheels >= 2 && Math.abs(vehicle.speed) > 3
        ? Math.min(
            1,
            Math.abs(vehicle.drift.slipAngle) * 1.7 +
              vehicle.handbrake * 0.3 +
              vehicle.brake * 0.15,
          )
        : 0;
    this.tireGain!.gain.setTargetAtTime(tire * 0.16, now, 0.06);
    this.windGain!.gain.setTargetAtTime(
      Math.min(0.1, Math.abs(vehicle.speed) ** 2 / 25000) * (cockpit ? 0.35 : 1),
      now,
      0.2,
    );
    if (newCollision && now - this.lastImpact > 0.18 && this.active) {
      this.lastImpact = now;
      this.impactGain!.gain.cancelScheduledValues(now);
      this.impactGain!.gain.setValueAtTime(0.28, now);
      this.impactGain!.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    }
  }

  reset(): void {
    this.lastCollision = 0;
    if (this.context && this.impactGain) {
      this.impactGain.gain.cancelScheduledValues(this.context.currentTime);
      this.impactGain.gain.value = 0;
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("keydown", this.gesture);
    window.removeEventListener("pointerdown", this.gesture);
    this.releaseResources();
  }

  private releaseResources(): void {
    this.oscillators.forEach((oscillator) => {
      oscillator.stop();
      oscillator.disconnect();
    });
    this.oscillators.length = 0;
    try {
      this.noise?.stop();
    } catch {
      /* Creation may have failed before start(). */
    }
    this.noise?.disconnect();
    this.nodes.forEach((node) => node.disconnect());
    this.nodes = [];
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.context = undefined;
    this.master = this.engineGain = this.tireGain = this.windGain = this.impactGain = undefined;
    this.noise = undefined;
    this.filter = undefined;
  }
}
