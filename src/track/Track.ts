import { CatmullRomCurve3, Vector3, Quaternion, Matrix4 } from "three/webgpu";
import { TRACKS, type TrackDefinition, type TrackId } from "./catalog";

export const TRACK_CONFIG = TRACKS[0];
export interface TrackSample {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
}

/** One centerline supplies road geometry, barriers, reset poses and the HUD map. */
export class Track {
  readonly samples: TrackSample[];
  readonly length: number;
  readonly width: number;
  readonly definition: TrackDefinition;
  readonly startIndex = 17;
  readonly mapViewBox: string;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;

  constructor(id: TrackId = "practice") {
    this.definition = TRACKS.find((t) => t.id === id) ?? TRACKS[0];
    this.width = this.definition.width;
    const curve = new CatmullRomCurve3(
      this.definition.points.map(([x, y, z]) => new Vector3(x, y, z)),
      true,
      "centripetal",
    );
    curve.arcLengthDivisions = 2048;
    this.length = curve.getLength();
    this.samples = Array.from({ length: this.definition.samples }, (_, i) => {
      const p = curve.getPointAt(i / this.definition.samples);
      const t = curve.getTangentAt(i / this.definition.samples).normalize();
      return { x: p.x, y: p.y, z: p.z, tx: t.x, ty: t.y, tz: t.z };
    });
    const minX = Math.min(...this.samples.map((s) => s.x)) - 30,
      minZ = Math.min(...this.samples.map((s) => -s.z)) - 30;
    const width = Math.max(...this.samples.map((s) => s.x)) - minX + 30,
      height = Math.max(...this.samples.map((s) => -s.z)) - minZ + 30;
    this.mapViewBox = `${minX} ${minZ} ${width} ${height}`;
    this.vertices = new Float32Array(this.samples.length * 6);
    this.indices = new Uint32Array(this.samples.length * 6);
    this.samples.forEach((s, i) => {
      const next = (i + 1) % this.samples.length;
      this.vertices.set(
        [
          s.x - (s.tz * this.width) / 2,
          s.y,
          s.z + (s.tx * this.width) / 2,
          s.x + (s.tz * this.width) / 2,
          s.y,
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
    return {
      position: { x: s.x, y: s.y + 0.9, z: s.z },
      rotation: this.orientation(s.tx, s.ty, s.tz),
    };
  }

  orientation(x: number, y: number, z: number): Quaternion {
    const forward = new Vector3(x, y, z).normalize();
    const left = new Vector3(z, 0, -x).normalize();
    const up = new Vector3().crossVectors(forward, left).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(left, up, forward));
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
          y: (s.y + n.y) / 2,
          z: (az + bz) / 2,
          yaw: Math.atan2(bx - ax, bz - az),
          rotation: this.orientation(bx - ax, n.y - s.y, bz - az),
          length: Math.hypot(bx - ax, n.y - s.y, bz - az) + 0.16,
        };
      }),
    );
  }
}
