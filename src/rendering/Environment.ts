import {
  Group,
  InstancedMesh,
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
import type { EnvironmentAssets, EnvironmentModel } from "./EnvironmentAssets";
import { buildingModel } from "./Architecture";
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
  private readonly batches: {
    near: InstancedMesh[];
    far: InstancedMesh[];
    placements: { position: Vector3; height: number; yaw: number }[];
  }[] = [];
  private readonly dummy = new Object3D();
  private countdown = 0;
  detailDistance = 180;
  constructor(track: Track, assets: EnvironmentAssets) {
    let seed = 851;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (const id of [
      "pine_sapling_small",
      "boulder_01",
      "wild_rooibos_bush",
      "street_lamp_01",
    ] as EnvironmentModel[]) {
      const lamp = id === "street_lamp_01";
      const count = lamp
        ? track.definition.theme === "city"
          ? 100
          : 24
        : id === "pine_sapling_small"
          ? track.definition.theme === "city"
            ? 45
            : 180
          : 130;
      const placements = [];
      for (let i = 0; i < count; i++) {
        let x = 0,
          z = 0,
          d = 0,
          y = 0,
          yaw = 0;
        do {
          const s =
            track.samples[
              lamp
                ? Math.floor((i * track.samples.length) / count)
                : Math.floor(random() * track.samples.length)
            ];
          const side = i % 2 ? -1 : 1;
          const offset = side * (lamp ? 12.5 : 18 + random() * 85);
          x = s.x + s.tz * offset;
          z = s.z - s.tx * offset;
          const n = track.samples[track.nearest(x, z)];
          d = Math.hypot(x - n.x, z - n.z);
          y = terrainHeight(track, x, z);
          yaw = lamp ? Math.atan2(s.tx, s.tz) + (side > 0 ? Math.PI : 0) : random() * Math.PI * 2;
        } while (!lamp && (d < 17 || (track.definition.theme === "coast" && y < 0.5)));
        const height = lamp
          ? 7
          : id === "pine_sapling_small"
            ? 4.5 + random() * 6
            : id === "boulder_01"
              ? 1.2 + random() * 3.2
              : 0.6 + random() * 1.2;
        placements.push({ position: new Vector3(x, y - 0.1, z), height, yaw });
      }
      const near = assets.createBatch(id, "near", count);
      const far = assets.createBatch(id, "far", count);
      this.root.add(...near, ...far);
      this.batches.push({ near, far, placements });
    }
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
    if (track.definition.theme === "city") this.addCity(track, random, assets);
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
  private addCity(track: Track, random: () => number, assets: EnvironmentAssets): void {
    const models = [
      buildingModel(assets.surface("concrete_wall_006"), 4, true),
      buildingModel(assets.surface("concrete_wall_006"), 8, false),
      buildingModel(assets.surface("concrete_wall_006"), 6, true),
    ];
    for (const model of models) {
      const meshes = model.children.map((child) => {
        const source = child as Mesh;
        const mesh = new InstancedMesh(source.geometry, source.material, 26);
        mesh.castShadow = mesh.receiveShadow = true;
        this.root.add(mesh);
        return mesh;
      });
      for (let i = 0; i < 26; i++) {
        let x = 0,
          z = 0,
          d = 0;
        do {
          const s = track.samples[Math.floor(random() * track.samples.length)];
          const offset = (random() > 0.5 ? 1 : -1) * (38 + random() * 100);
          x = s.x + s.tz * offset;
          z = s.z - s.tx * offset;
          const n = track.samples[track.nearest(x, z)];
          d = Math.hypot(n.x - x, n.z - z);
        } while (d < 32);
        this.dummy.position.set(x, terrainHeight(track, x, z) - 0.25, z);
        this.dummy.scale.setScalar(0.85 + random() * 0.3);
        this.dummy.rotation.set(0, (Math.round(random() * 4) * Math.PI) / 2, 0);
        this.dummy.updateMatrix();
        for (const mesh of meshes) mesh.setMatrixAt(i, this.dummy.matrix);
      }
      model.clear();
    }
  }
  update(position: Vector3, dt: number): void {
    this.countdown -= dt;
    if (this.countdown > 0) return;
    this.countdown = 0.15;
    for (const batch of this.batches) {
      let near = 0,
        far = 0;
      for (const placement of batch.placements) {
        const distance = placement.position.distanceTo(position);
        if (distance > Math.max(260, this.detailDistance * 2.5)) continue;
        const detailed = distance < this.detailDistance;
        const index = detailed ? near++ : far++;
        this.dummy.position.copy(placement.position);
        this.dummy.scale.setScalar(placement.height);
        this.dummy.rotation.set(0, placement.yaw, 0);
        this.dummy.updateMatrix();
        for (const mesh of detailed ? batch.near : batch.far)
          mesh.setMatrixAt(index, this.dummy.matrix);
      }
      for (const mesh of batch.near) mesh.count = near;
      for (const mesh of batch.far) mesh.count = far;
      for (const mesh of [...batch.near, ...batch.far]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }
}
