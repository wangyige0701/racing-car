import {
  Group,
  InstancedMesh,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshStandardNodeMaterial,
  Mesh,
  BoxGeometry,
  CanvasTexture,
  SRGBColorSpace,
  PlaneGeometry,
  Object3D,
  Vector3,
  Color,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Track } from "../track/Track";

export function terrainHeight(track: Track, x: number, z: number): number {
  const s = track.samples[track.nearest(x, z)],
    d = Math.hypot(x - s.x, z - s.z);
  return (
    -0.05 +
    Math.min(1, Math.max(0, (d - 20) / 80)) * (10 + 8 * Math.sin(x * 0.014) * Math.cos(z * 0.018))
  );
}

/** Instanced scenery with distance-selected canopy detail and reusable local sign textures. */
export class Environment {
  readonly root = new Group();
  private readonly trees: { position: Vector3; scale: number; color: Color }[] = [];
  private readonly near: InstancedMesh;
  private readonly far: InstancedMesh;
  private readonly dummy = new Object3D();
  private countdown = 0;
  detailDistance = 180;
  constructor(track: Track) {
    const foliage = new MeshStandardNodeMaterial({ color: "#476644", roughness: 1 });
    const layers = [
      new ConeGeometry(2.5, 4, 11).translate(0, 3, 0),
      new ConeGeometry(1.9, 3.5, 11).translate(0, 4.8, 0),
      new ConeGeometry(1.2, 3, 11).translate(0, 6.4, 0),
    ];
    const canopy = mergeGeometries(layers)!;
    layers.forEach((g) => g.dispose());
    this.near = new InstancedMesh(canopy, foliage, 230);
    this.far = new InstancedMesh(new ConeGeometry(2.4, 7, 7).translate(0, 4.6, 0), foliage, 230);
    const trunks = new InstancedMesh(
      new CylinderGeometry(0.22, 0.43, 4, 7).translate(0, 2, 0),
      new MeshStandardNodeMaterial({ color: "#5d4c3a", roughness: 1 }),
      230,
    );
    this.near.castShadow = true;
    let seed = 851;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 230; i++) {
      let x = 0,
        z = 0,
        d = 0;
      do {
        x = (random() - 0.5) * 750;
        z = (random() - 0.5) * 750;
        const s = track.samples[track.nearest(x, z)];
        d = Math.hypot(x - s.x, z - s.z);
      } while (d < 23);
      const tree = {
        position: new Vector3(x, terrainHeight(track, x, z), z),
        scale: 0.8 + random() * 1.3,
        color: new Color().setHSL(0.28 + random() * 0.04, 0.26, 0.38 + random() * 0.13),
      };
      this.trees.push(tree);
      this.dummy.position.copy(tree.position);
      this.dummy.scale.setScalar(tree.scale);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.add(trunks, this.near, this.far);
    const hills = new InstancedMesh(
      new IcosahedronGeometry(1, 2),
      new MeshStandardNodeMaterial({ color: "#6a7b69", roughness: 1 }),
      20,
    );
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      this.dummy.position.set(Math.cos(angle) * 620, 10, Math.sin(angle) * 620);
      this.dummy.scale.set(100 + random() * 80, 45 + random() * 90, 100 + random() * 80);
      this.dummy.rotation.y = random() * 6;
      this.dummy.updateMatrix();
      hills.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.add(hills);
    for (const corner of [60, 130, 200])
      for (const distance of [100, 50]) {
        const index =
          (corner -
            Math.round(distance / (track.length / track.samples.length)) +
            track.samples.length) %
          track.samples.length;
        const s = track.samples[index];
        this.sign(s.x + s.tz * 11.5, s.z - s.tx * 11.5, Math.atan2(s.tx, s.tz), String(distance));
      }
    this.update(new Vector3(), 1);
  }
  private sign(x: number, z: number, yaw: number, label: string) {
    const group = new Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw + Math.PI;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e1e5d9";
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = "#21342c";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 64, 72);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    const board = new Mesh(
      new PlaneGeometry(1.3, 1),
      new MeshStandardNodeMaterial({ map, roughness: 0.8 }),
    );
    board.position.y = 1.7;
    const post = new Mesh(
      new BoxGeometry(0.08, 1.8, 0.08),
      new MeshStandardNodeMaterial({ color: "#8c9589", metalness: 0.6, roughness: 0.5 }),
    );
    post.position.y = 0.9;
    group.add(board, post);
    this.root.add(group);
  }
  update(position: Vector3, dt: number): void {
    this.countdown -= dt;
    if (this.countdown > 0) return;
    this.countdown = 0.15;
    let near = 0,
      far = 0;
    for (const tree of this.trees) {
      const detailed = tree.position.distanceToSquared(position) < this.detailDistance ** 2;
      const mesh = detailed ? this.near : this.far;
      const i = detailed ? near++ : far++;
      this.dummy.position.copy(tree.position);
      this.dummy.scale.setScalar(tree.scale);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, tree.color);
    }
    this.near.count = near;
    this.far.count = far;
    for (const mesh of [this.near, this.far]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}
