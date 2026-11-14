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

/** 将驾驶平面投影为北向上的 SVG 地图，且不镜像左右方向。 */
export function projectTrackMap(x: number, z: number): { x: number; y: number } {
  return { x: -x, y: -z };
}

/**
 * SVG 标记朝向自身局部 -Y 轴。SVG 的旋转为顺时针，因此其朝向
 * 是车辆 +X 向左 / +Z 向前偏航角的反向值。
 */
export function trackMapHeading(forwardX: number, forwardZ: number): number {
  return ((Math.atan2(-forwardX, forwardZ) * 180) / Math.PI + 360) % 360;
}

/** 一条中心线同时提供道路几何、护栏、重置姿态和 HUD 地图数据。 */
export class Track {
  readonly samples: TrackSample[];
  readonly length: number;
  readonly width: number;
  readonly definition: TrackDefinition;
  readonly startIndex = 17;
  readonly mapViewBox: string;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly corners: number[];

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
    const count = this.samples.length;
    const candidates = this.samples
      .map((s, i) => {
        const next = this.samples[(i + 1) % count];
        return {
          index: i,
          bend: Math.abs(
            Math.atan2(s.tx * next.tz - s.tz * next.tx, s.tx * next.tx + s.tz * next.tz),
          ),
        };
      })
      .sort((a, b) => b.bend - a.bend);
    this.corners = [];
    for (const candidate of candidates) {
      if (
        this.corners.every(
          (i) =>
            (Math.min(Math.abs(i - candidate.index), count - Math.abs(i - candidate.index)) *
              this.length) /
              count >
            150,
        )
      )
        this.corners.push(candidate.index);
      if (this.corners.length === 6) break;
    }
    const mapSamples = this.samples.map((s) => projectTrackMap(s.x, s.z));
    const minX = Math.min(...mapSamples.map((point) => point.x)) - 30,
      minY = Math.min(...mapSamples.map((point) => point.y)) - 30;
    const width = Math.max(...mapSamples.map((point) => point.x)) - minX + 30,
      height = Math.max(...mapSamples.map((point) => point.y)) - minY + 30;
    this.mapViewBox = `${minX} ${minY} ${width} ${height}`;
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
