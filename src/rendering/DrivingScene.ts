import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
} from "three/webgpu";
import { color, mix, positionWorld, sin } from "three/tsl";
import { VehicleVisual } from "../vehicle/VehicleVisual";
import { ChaseCamera } from "../camera/ChaseCamera";
import type { Track } from "../track/Track";
import type { VehiclePhysics } from "../vehicle/VehiclePhysics";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

export class DrivingScene {
  readonly scene = new Scene();
  readonly chase = new ChaseCamera();
  readonly vehicle = new VehicleVisual();
  readonly sun = new DirectionalLight("#fff0c8", 3.6);
  get camera() {
    return this.chase.camera;
  }

  constructor(track: Track) {
    this.scene.background = new Color("#b9d4dc");
    this.scene.fog = new Fog("#b9d4dc", 170, 780);
    this.scene.add(new HemisphereLight("#f6f5df", "#4b6345", 2.7));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -32,
      right: 32,
      top: 32,
      bottom: -32,
      near: 1,
      far: 120,
    });
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target, this.vehicle.root);

    const grass = new MeshStandardNodeMaterial({ roughness: 1 });
    grass.colorNode = mix(
      color("#76855a"),
      color("#88996a"),
      sin(positionWorld.x.mul(0.1))
        .mul(sin(positionWorld.z.mul(0.13)))
        .mul(0.5)
        .add(0.5),
    );
    const ground = this.mesh(new PlaneGeometry(1600, 1600), grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;

    const roadMaterial = new MeshStandardNodeMaterial({ roughness: 0.95 });
    roadMaterial.colorNode = mix(
      color("#414b4e"),
      color("#444d4f"),
      sin(positionWorld.x.mul(0.85))
        .mul(sin(positionWorld.z.mul(0.72)))
        .mul(0.5)
        .add(0.5),
    );
    const roadGeometry = new BufferGeometry();
    roadGeometry.setAttribute("position", new BufferAttribute(track.vertices, 3));
    roadGeometry.setIndex(new BufferAttribute(track.indices, 1));
    roadGeometry.computeVertexNormals();
    const road = this.mesh(roadGeometry, roadMaterial);
    road.receiveShadow = true;
    const markings = new MeshStandardNodeMaterial({ color: "#e4e4c8", roughness: 0.9 });
    const curbMaterial = new MeshStandardNodeMaterial({ roughness: 0.8 });
    const barrierMaterial = new MeshStandardNodeMaterial({
      color: "#bcc1b6",
      metalness: 0.25,
      roughness: 0.75,
    });
    const segments = track.barrierSegments();
    const barriers = new InstancedMesh(new BoxGeometry(1, 1, 1), barrierMaterial, segments.length);
    const curbs = new InstancedMesh(new BoxGeometry(1, 1, 1), curbMaterial, segments.length);
    const lines = new InstancedMesh(new BoxGeometry(1, 1, 1), markings, track.samples.length * 2);
    const dashes = new InstancedMesh(
      new BoxGeometry(0.13, 0.008, 3),
      markings,
      Math.ceil(track.samples.length / 2),
    );
    const dummy = new Object3D();
    segments.forEach((s, i) => {
      dummy.position.set(s.x, 0.65, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.set(0.46, 1.3, s.length);
      dummy.updateMatrix();
      barriers.setMatrixAt(i, dummy.matrix);
    });
    track.samples.forEach((s, i) => {
      const n = track.samples[(i + 1) % track.samples.length];
      const length = Math.hypot(n.x - s.x, n.z - s.z) + 0.12;
      const yaw = Math.atan2(n.x - s.x, n.z - s.z);
      const cx = (s.x + n.x) / 2,
        cz = (s.z + n.z) / 2;
      [-1, 1].forEach((side, j) => {
        dummy.rotation.set(0, yaw, 0);
        dummy.position.set(
          cx + s.tz * (track.width / 2 + 0.35) * side,
          0.015,
          cz - s.tx * (track.width / 2 + 0.35) * side,
        );
        dummy.scale.set(0.7, 0.04, length);
        dummy.updateMatrix();
        curbs.setMatrixAt(i * 2 + j, dummy.matrix);
        curbs.setColorAt(i * 2 + j, new Color(i % 2 ? "#e4e3d4" : "#9b3e35"));
        dummy.position.set(
          cx + s.tz * (track.width / 2 - 0.2) * side,
          0.012,
          cz - s.tx * (track.width / 2 - 0.2) * side,
        );
        dummy.scale.set(0.12, 0.01, length);
        dummy.updateMatrix();
        lines.setMatrixAt(i * 2 + j, dummy.matrix);
      });
      if (i % 2 === 0) {
        dummy.position.set(s.x, 0.008, s.z);
        dummy.rotation.set(0, Math.atan2(s.tx, s.tz), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dashes.setMatrixAt(i / 2, dummy.matrix);
      }
    });
    barriers.castShadow = true;
    barriers.receiveShadow = true;
    this.scene.add(barriers, curbs, lines, dashes);
    this.addLandscape(track);
    this.addStartGate(track);
  }

  private mesh(geometry: BufferGeometry, material: Material, parent: Object3D = this.scene): Mesh {
    const mesh = new Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  private addLandscape(track: Track): void {
    const dummy = new Object3D();
    const bark = new MeshStandardNodeMaterial({ color: "#665545", roughness: 1 });
    const foliage = new MeshStandardNodeMaterial({
      color: "#3b5b43",
      roughness: 1,
      flatShading: true,
    });
    const trunks = new InstancedMesh(new CylinderGeometry(0.25, 0.4, 3, 5), bark, 230);
    const crowns = new InstancedMesh(new ConeGeometry(2.3, 7, 7), foliage, 230);
    let seed = 851;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 230; i++) {
      let x = 0,
        z = 0;
      do {
        x = (random() - 0.5) * 750;
        z = (random() - 0.5) * 750;
      } while (
        Math.hypot(
          x - track.samples[track.nearest(x, z)].x,
          z - track.samples[track.nearest(x, z)].z,
        ) < 23
      );
      const scale = 0.8 + random() * 1.3;
      dummy.position.set(x, 1.5 * scale, z);
      dummy.scale.setScalar(scale);
      dummy.rotation.set(0, random() * 6.28, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 5.1 * scale;
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, new Color().setHSL(0.28 + random() * 0.04, 0.22, 0.3 + random() * 0.1));
    }
    trunks.castShadow = crowns.castShadow = true;
    this.scene.add(trunks, crowns);
    const hills = new InstancedMesh(
      new ConeGeometry(1, 1, 9),
      new MeshStandardNodeMaterial({ color: "#647e70", roughness: 1, flatShading: true }),
      20,
    );
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2,
        height = 65 + random() * 110;
      dummy.position.set(Math.cos(angle) * 620, height / 2 - 8, Math.sin(angle) * 620);
      dummy.scale.set(95 + random() * 90, height, 95 + random() * 90);
      dummy.rotation.set(0, random() * 6.28, 0);
      dummy.updateMatrix();
      hills.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(hills);
    const building = new Group();
    const start = track.samples[12];
    building.position.set(start.x + start.tz * 27, 0, start.z - start.tx * 27);
    building.rotation.y = Math.atan2(start.tx, start.tz);
    const wall = new MeshStandardNodeMaterial({ color: "#b9baaa", roughness: 0.85 });
    const glass = new MeshStandardNodeMaterial({
      color: "#334c50",
      metalness: 0.45,
      roughness: 0.23,
    });
    const base = this.mesh(new BoxGeometry(12, 5, 34), wall, building);
    base.position.y = 2.5;
    const windows = this.mesh(new BoxGeometry(12.1, 1.8, 30), glass, building);
    windows.position.y = 3.2;
    const roof = this.mesh(new BoxGeometry(13, 0.3, 35), wall, building);
    roof.position.y = 5.1;
    building.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(building);
  }

  private addStartGate(track: Track): void {
    const start = track.samples[17];
    const gate = new Group();
    gate.position.set(start.x, 0, start.z);
    gate.rotation.y = Math.atan2(start.tx, start.tz);
    const dark = new MeshStandardNodeMaterial({ color: "#293a35", metalness: 0.4, roughness: 0.5 });
    for (const x of [-10, 10]) {
      const post = this.mesh(new BoxGeometry(0.45, 5.5, 0.45), dark, gate);
      post.position.set(x, 2.75, 0);
    }
    const beam = this.mesh(new BoxGeometry(20.4, 1.1, 0.55), dark, gate);
    beam.position.y = 5.3;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#263a32";
      context.fillRect(0, 0, 1024, 96);
      context.fillStyle = "#d9ef93";
      context.font = "italic 900 57px sans-serif";
      context.fillText("APEX", 45, 68);
      context.fillStyle = "#edf1dc";
      context.font = "500 23px sans-serif";
      context.fillText("MOTORSPORT  /  PROVING GROUND", 300, 59);
      const map = new CanvasTexture(canvas);
      map.colorSpace = SRGBColorSpace;
      const signMaterial = new MeshStandardNodeMaterial({ map, roughness: 0.8 });
      for (const side of [-1, 1]) {
        const sign = this.mesh(new PlaneGeometry(19.7, 0.92), signMaterial, gate);
        sign.position.set(0, 5.3, side * 0.285);
        sign.rotation.y = side < 0 ? Math.PI : 0;
      }
    }
    const checker = new InstancedMesh(
      new BoxGeometry(0.8, 0.008, 0.8),
      new MeshStandardNodeMaterial({ roughness: 0.8 }),
      40,
    );
    const dummy = new Object3D();
    for (let i = 0; i < 40; i++) {
      dummy.position.set(((i % 20) - 9.5) * 0.8, 0.012, Math.floor(i / 20) * 0.8);
      dummy.updateMatrix();
      checker.setMatrixAt(i, dummy.matrix);
      checker.setColorAt(i, new Color(((i % 20) + Math.floor(i / 20)) % 2 ? "#f0f0dd" : "#252d2b"));
    }
    gate.add(checker);
    this.scene.add(gate);
    gate.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
  }

  update(
    vehicle: VehiclePhysics,
    alpha: number,
    dt: number,
    physics: PhysicsWorld,
    snap = false,
  ): void {
    this.vehicle.update(vehicle, alpha);
    this.chase.update(this.vehicle.root, vehicle.speed, dt, physics.world, snap);
    this.sun.target.position.copy(this.vehicle.root.position);
    this.sun.position.copy(this.vehicle.root.position).add({ x: -25, y: 50, z: -20 });
  }
  resize(width: number, height: number): void {
    this.chase.resize(width, height);
  }

  dispose(): void {
    const geometries = new Set<BufferGeometry>(),
      materials = new Set<Material>(),
      textures = new Set<Texture>();
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          if (material instanceof MeshStandardNodeMaterial && material.map)
            textures.add(material.map);
        }
      }
      if (object instanceof InstancedMesh) object.dispose();
      if (object instanceof DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    this.scene.clear();
  }
}
