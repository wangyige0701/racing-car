import type { Vector3 } from "three/webgpu";
import type { Track } from "./Track";

/** Ordered directional gates; time advances only through fixed simulation steps. */
export class LapTimer {
  laps = 0;
  current = 0;
  best = 0;
  last = 0;
  next = 0;
  started = false;
  valid = true;
  wrongWay = false;
  private backwards = 0;
  readonly gates: number[];
  constructor(private readonly track: Track) {
    this.gates = Array.from(
      { length: 8 },
      (_, i) =>
        (track.startIndex + Math.round((i * track.samples.length) / 8)) % track.samples.length,
    );
  }
  invalidate(): void {
    this.started = false;
    this.valid = false;
    this.current = 0;
    this.next = 0;
    this.backwards = 0;
    this.wrongWay = false;
  }
  update(previous: Vector3, position: Vector3, dt: number, grounded: number): void {
    if (dt <= 0) return;
    if (this.started) this.current += dt;
    const dx = position.x - previous.x,
      dy = position.y - previous.y,
      dz = position.z - previous.z;
    const nearest = this.track.samples[this.track.nearest(position.x, position.z)];
    const lateral = Math.abs(
      (position.x - nearest.x) * nearest.tz - (position.z - nearest.z) * nearest.tx,
    );
    this.backwards =
      (dx * nearest.tx + dz * nearest.tz) / dt < -2
        ? this.backwards + dt
        : Math.max(0, this.backwards - dt * 2);
    this.wrongWay = this.backwards > 0.8;
    if (lateral > this.track.width / 2 + 1 || Math.hypot(dx, dy, dz) > Math.max(3, dt * 90)) {
      if (this.started) this.valid = false;
      return;
    }
    const gate = this.track.samples[this.gates[this.next]];
    const before = (previous.x - gate.x) * gate.tx + (previous.z - gate.z) * gate.tz;
    const after = (position.x - gate.x) * gate.tx + (position.z - gate.z) * gate.tz;
    if (before >= 0 || after < 0 || after - before < 0.0001 || grounded < 2) return;
    const fraction = -before / (after - before);
    const x = previous.x + dx * fraction,
      z = previous.z + dz * fraction,
      y = previous.y + dy * fraction;
    if (
      Math.abs((x - gate.x) * gate.tz - (z - gate.z) * gate.tx) > this.track.width / 2 ||
      Math.abs(y - gate.y) > 2.5
    )
      return;
    if (this.next === 0) {
      if (this.started && this.valid) {
        this.laps++;
        this.last = this.current - dt * (1 - fraction);
        this.best = this.best ? Math.min(this.best, this.last) : this.last;
      }
      this.current = dt * (1 - fraction);
      this.started = true;
      this.valid = true;
    }
    this.next = (this.next + 1) % this.gates.length;
  }
}
