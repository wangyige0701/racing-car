import { CatmullRomCurve3, Vector3 } from "three/webgpu";

export const TRACK_CONFIG = {
  name: "松岭试车场",
  width: 16,
  samples: 240,
  points: [
    [-100, -150],
    [-100, -45],
    [-95, 65],
    [-55, 145],
    [40, 165],
    [125, 110],
    [145, 10],
    [100, -95],
    [15, -145],
  ],
} as const;
export interface TrackSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** One centerline supplies road geometry, barriers, reset poses and the HUD map. */
export class Track {
  readonly samples: TrackSample[];
  readonly length: number;
  readonly width = TRACK_CONFIG.width;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;

  constructor() {
    const curve = new CatmullRomCurve3(
      TRACK_CONFIG.points.map(([x, z]) => new Vector3(x, 0, z)),
      true,
      "centripetal",
    );
    curve.arcLengthDivisions = 2048;
    this.length = curve.getLength();
    this.samples = Array.from({ length: TRACK_CONFIG.samples }, (_, i) => {
      const p = curve.getPointAt(i / TRACK_CONFIG.samples);
      const t = curve.getTangentAt(i / TRACK_CONFIG.samples).normalize();
      return { x: p.x, z: p.z, tx: t.x, tz: t.z };
    });
    this.vertices = new Float32Array(this.samples.length * 6);
    this.indices = new Uint32Array(this.samples.length * 6);
    this.samples.forEach((s, i) => {
      const next = (i + 1) % this.samples.length;
      this.vertices.set(
        [
          s.x - (s.tz * this.width) / 2,
          0,
          s.z + (s.tx * this.width) / 2,
          s.x + (s.tz * this.width) / 2,
          0,
          s.z - (s.tx * this.width) / 2,
        ],
        i * 6,
      );
      this.indices.set([i * 2, next * 2, i * 2 + 1, i * 2 + 1, next * 2, next * 2 + 1], i * 6);
    });
  }

  nearest(x: number, z: number): number {
    let best = 0,
      distance = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i],
        d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    return best;
  }

  pose(index = 10) {
    const s = this.samples[(index + this.samples.length) % this.samples.length];
    const yaw = Math.atan2(s.tx, s.tz);
    return {
      position: { x: s.x, y: 0.9, z: s.z },
      rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    };
  }

  barrierSegments() {
    return this.samples.flatMap((s, i) =>
      [-1, 1].map((side) => {
        const n = this.samples[(i + 1) % this.samples.length],
          offset = (this.width / 2 + 1.15) * side;
        const ax = s.x + s.tz * offset,
          az = s.z - s.tx * offset;
        const bx = n.x + n.tz * offset,
          bz = n.z - n.tx * offset;
        return {
          x: (ax + bx) / 2,
          z: (az + bz) / 2,
          yaw: Math.atan2(bx - ax, bz - az),
          length: Math.hypot(bx - ax, bz - az) + 0.16,
        };
      }),
    );
  }
}
