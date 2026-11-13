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
  const base =
    s.y +
    ((x - s.x) * s.tx + (z - s.z) * s.tz) * s.ty -
    (track.definition.id === "practice" ? 0.05 : 0.8);
  if (track.definition.theme === "city") return base;
  if (track.definition.theme === "coast" && x < -450 && d > 25)
    return base - Math.min(1, (d - 25) / 70) * (s.y + 4);
  return (
    base +
    Math.min(1, Math.max(0, (d - 32) / 80)) * (10 + 8 * Math.sin(x * 0.014) * Math.cos(z * 0.018))
  );
}

export function terrainGeometry(track: Track): PlaneGeometry {
  const terrain = new PlaneGeometry(1600, 1600, 96, 96);
  terrain.rotateX(-Math.PI / 2);
  const positions = terrain.getAttribute("position");
  for (let i = 0; i < positions.count; i++)
    positions.setY(i, terrainHeight(track, positions.getX(i), positions.getZ(i)));
  terrain.computeVertexNormals();
  return terrain;
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
    const treeCount = track.definition.theme === "city" ? 45 : 230;
    trunks.count = treeCount;
    for (let i = 0; i < treeCount; i++) {
      let x = 0,
        z = 0,
        d = 0;
      do {
        const sample = track.samples[Math.floor(random() * track.samples.length)];
        const offset = (random() > 0.5 ? 1 : -1) * (26 + random() * 110);
        x = sample.x + sample.tz * offset;
        z = sample.z - sample.tx * offset;
        const s = track.samples[track.nearest(x, z)];
        d = Math.hypot(x - s.x, z - s.z);
      } while (d < 23 || (track.definition.theme === "coast" && terrainHeight(track, x, z) < 0.5));
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
      this.dummy.position.set(
        Math.cos(angle) * (track.definition.id === "practice" ? 620 : 900),
        10,
        Math.sin(angle) * (track.definition.id === "practice" ? 620 : 900),
      );
      this.dummy.scale.set(100 + random() * 80, 45 + random() * 90, 100 + random() * 80);
      this.dummy.rotation.y = random() * 6;
      this.dummy.updateMatrix();
      hills.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.add(hills);
    hills.visible = track.definition.theme !== "city";
    if (track.definition.theme === "coast") {
      const water = new Mesh(
        new PlaneGeometry(1000, 2000),
        new MeshStandardNodeMaterial({ color: "#367d8d", metalness: 0.3, roughness: 0.28 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(-850, 0.2, 0);
      this.root.add(water);
    }
    if (track.definition.theme === "city") this.addCity(track, random);
    for (const corner of track.corners)
      for (const distance of [100, 50]) {
        const index =
          (corner -
            Math.round(distance / (track.length / track.samples.length)) +
            track.samples.length) %
          track.samples.length;
        const s = track.samples[index];
        this.sign(
          s.x + s.tz * 11.5,
          s.z - s.tx * 11.5,
          Math.atan2(s.tx, s.tz),
          String(distance),
          s.y,
        );
      }
    for (let i = 1; i < 8; i++) {
      const s =
        track.samples[
          (track.startIndex + Math.round((i * track.samples.length) / 8)) % track.samples.length
        ];
      this.sign(s.x + s.tz * 10.5, s.z - s.tx * 10.5, Math.atan2(s.tx, s.tz), `CP ${i}`, s.y);
    }
    this.update(new Vector3(), 1);
  }
  private sign(x: number, z: number, yaw: number, label: string, y: number) {
    const group = new Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw + Math.PI;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e1e5d9";
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = "#21342c";
    ctx.font = label.startsWith("CP") ? "bold 40px sans-serif" : "bold 64px sans-serif";
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
  private addCity(track: Track, random: () => number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#50616b";
    ctx.fillRect(0, 0, 128, 256);
    for (let y = 8; y < 250; y += 24)
      for (let x = 8; x < 120; x += 22) {
        ctx.fillStyle = random() > 0.7 ? "#c7c4a2" : "#253c4c";
        ctx.fillRect(x, y, 12, 15);
      }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    const buildings = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardNodeMaterial({ map, roughness: 0.7 }),
      120,
    );
    for (let i = 0; i < 120; i++) {
      let x = 0,
        z = 0,
        d = 0;
      do {
        const s = track.samples[Math.floor(random() * track.samples.length)];
        const offset = (random() > 0.5 ? 1 : -1) * (40 + random() * 120);
        x = s.x + s.tz * offset;
        z = s.z - s.tx * offset;
        const n = track.samples[track.nearest(x, z)];
        d = Math.hypot(n.x - x, n.z - z);
      } while (d < 35);
      const height = 12 + random() * 44;
      this.dummy.position.set(x, terrainHeight(track, x, z) + height / 2, z);
      this.dummy.scale.set(12 + random() * 12, height, 12 + random() * 12);
      this.dummy.rotation.set(0, (Math.round(random() * 4) * Math.PI) / 2, 0);
      this.dummy.updateMatrix();
      buildings.setMatrixAt(i, this.dummy.matrix);
    }
    buildings.castShadow = true;
    buildings.receiveShadow = true;
    this.root.add(buildings);
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
