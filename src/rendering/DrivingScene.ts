import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
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
  DataTexture,
  EquirectangularReflectionMapping,
} from "three/webgpu";
import { disposeObject } from "./dispose";
import { TireSmoke } from "./TireSmoke";
import { Environment, terrainGeometry } from "./Environment";
import type { EnvironmentAssets } from "./EnvironmentAssets";
import { roadSurface } from "./RoadSurface";
import { TireMarks } from "./TireMarks";
import { QUALITY, type Quality } from "./quality";
import { ContactSparks } from "./ContactSparks";
import { pitBuilding } from "./Architecture";
import { guardrails } from "./RoadFurniture";
import { VehicleVisual } from "../vehicle/VehicleVisual";
import { CameraManager } from "../camera/CameraManager";
import type { Track } from "../track/Track";
import type { VehiclePhysics } from "../vehicle/VehiclePhysics";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

export class DrivingScene {
  readonly scene = new Scene();
  readonly cameras = new CameraManager();
  readonly vehicle: VehicleVisual;
  readonly smoke = new TireSmoke();
  readonly sparks = new ContactSparks();
  readonly marks = new TireMarks();
  readonly scenery: Environment;
  private readonly environment: DataTexture;
  private lastImpact = 0;
  readonly sun = new DirectionalLight("#fff0c8", 3.6);
  get camera() {
    return this.cameras.camera;
  }

  constructor(track: Track, vehicle: VehicleVisual, assets: EnvironmentAssets) {
    this.vehicle = vehicle;
    this.scenery = new Environment(track, assets);
    this.scene.add(this.scenery.root, this.marks.root);
    // 小型生成天空反射，由 WebGPU 预滤波后供 GLB PBR 车漆使用。
    const pixels = new Uint8Array(256 * 128 * 4);
    const sky = new Color("#a6c5db"),
      horizon = new Color("#edf0df"),
      groundColor = new Color("#526147");
    const sample = new Color();
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++) {
        const t = y / 127;
        sample
          .copy(t < 0.5 ? sky : horizon)
          .lerp(t < 0.5 ? horizon : groundColor, t < 0.5 ? t * 2 : (t - 0.5) * 2);
        const i = (y * 256 + x) * 4;
        pixels[i] = sample.r * 255;
        pixels[i + 1] = sample.g * 255;
        pixels[i + 2] = sample.b * 255;
        pixels[i + 3] = 255;
      }
    this.environment = new DataTexture(pixels, 256, 128);
    this.environment.mapping = EquirectangularReflectionMapping;
    this.environment.needsUpdate = true;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.85;
    this.scene.background = new Color("#b9d4dc");
    this.scene.fog = new Fog("#b9d4dc", 170, 780);
    this.scene.add(new HemisphereLight("#f6f5df", "#4b6345", 1.6));
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
    this.scene.add(this.sun, this.sun.target, this.vehicle.root, this.smoke.root, this.sparks.root);

    const grass = assets.surface(
      track.definition.theme === "city" ? "concrete_wall_006" : "forest_ground_04",
    );
    const terrain = terrainGeometry(track);
    const positions = terrain.getAttribute("position"),
      uv = terrain.getAttribute("uv");
    for (let i = 0; i < positions.count; i++)
      uv.setXY(i, positions.getX(i) / 6, positions.getZ(i) / 6);
    const ground = this.mesh(terrain, grass);
    ground.receiveShadow = true;

    const roadMaterial = roadSurface(assets);
    // 同一加宽表面提供路肩支撑与外观；轻微下移避免与主路面深度重叠。
    const shoulderGeometry = new BufferGeometry();
    shoulderGeometry.setAttribute("position", new BufferAttribute(track.surfaceVertices, 3));
    shoulderGeometry.setIndex(new BufferAttribute(track.indices, 1));
    shoulderGeometry.computeVertexNormals();
    const shoulder = this.mesh(
      shoulderGeometry,
      new MeshStandardNodeMaterial({ color: "#77796c", roughness: 1 }),
    );
    shoulder.position.y = -0.02;
    shoulder.receiveShadow = true;
    const roadGeometry = new BufferGeometry();
    roadGeometry.setAttribute("position", new BufferAttribute(track.vertices, 3));
    roadGeometry.setIndex(new BufferAttribute(track.indices, 1));
    const roadUV = new Float32Array((track.vertices.length / 3) * 2);
    for (let i = 0; i < track.vertices.length / 3; i++) {
      roadUV[i * 2] = track.vertices[i * 3] / 4;
      roadUV[i * 2 + 1] = track.vertices[i * 3 + 2] / 4;
    }
    roadGeometry.setAttribute("uv", new BufferAttribute(roadUV, 2));
    roadGeometry.computeVertexNormals();
    const road = this.mesh(roadGeometry, roadMaterial);
    road.receiveShadow = true;
    const markings = new MeshStandardNodeMaterial({ color: "#e4e4c8", roughness: 0.9 });
    const curbMaterial = new MeshStandardNodeMaterial({ roughness: 0.8 });
    const segments = track.barrierSegments();
    const curbs = new InstancedMesh(new BoxGeometry(1, 1, 1), curbMaterial, segments.length);
    const lines = new InstancedMesh(new BoxGeometry(1, 1, 1), markings, track.samples.length * 2);
    const dashes = new InstancedMesh(
      new BoxGeometry(0.13, 0.008, 3),
      markings,
      Math.ceil(track.samples.length / 2),
    );
    const dummy = new Object3D();
    track.samples.forEach((s, i) => {
      const n = track.samples[(i + 1) % track.samples.length];
      const length = Math.hypot(n.x - s.x, n.y - s.y, n.z - s.z) + 0.12;
      const rotation = track.orientation(n.x - s.x, n.y - s.y, n.z - s.z);
      const cx = (s.x + n.x) / 2,
        cz = (s.z + n.z) / 2;
      [-1, 1].forEach((side, j) => {
        dummy.quaternion.copy(rotation);
        dummy.position.set(
          cx + s.tz * (track.width / 2 + 0.35) * side,
          (s.y + n.y) / 2 + 0.015,
          cz - s.tx * (track.width / 2 + 0.35) * side,
        );
        dummy.scale.set(0.7, 0.04, length);
        dummy.updateMatrix();
        curbs.setMatrixAt(i * 2 + j, dummy.matrix);
        curbs.setColorAt(i * 2 + j, new Color(i % 2 ? "#e4e3d4" : "#9b3e35"));
        dummy.position.set(
          cx + s.tz * (track.width / 2 - 0.2) * side,
          (s.y + n.y) / 2 + 0.012,
          cz - s.tx * (track.width / 2 - 0.2) * side,
        );
        dummy.scale.set(0.12, 0.01, length);
        dummy.updateMatrix();
        lines.setMatrixAt(i * 2 + j, dummy.matrix);
      });
      if (i % 2 === 0) {
        dummy.position.set(s.x, s.y + 0.008, s.z);
        dummy.quaternion.copy(track.orientation(s.tx, s.ty, s.tz));
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dashes.setMatrixAt(i / 2, dummy.matrix);
      }
    });
    this.scene.add(guardrails(track), curbs, lines, dashes);
    this.addLandscape(track, assets);
    this.addStartGate(track);
  }

  private mesh(geometry: BufferGeometry, material: Material, parent: Object3D = this.scene): Mesh {
    const mesh = new Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  private addLandscape(track: Track, assets: EnvironmentAssets): void {
    const building = pitBuilding(assets.surface("concrete_wall_006"));
    const start = track.samples[12];
    building.position.set(start.x + start.tz * 27, start.y - 0.3, start.z - start.tx * 27);
    building.rotation.y = Math.atan2(start.tx, start.tz);
    this.scene.add(building);
  }

  private addStartGate(track: Track): void {
    const start = track.samples[track.startIndex];
    const gate = new Group();
    gate.position.set(start.x, start.y, start.z);
    gate.quaternion.copy(track.orientation(start.tx, start.ty, start.tz));
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
    this.updateCamera(vehicle, dt, physics, snap);
    if (snap) this.smoke.clear();
    else this.smoke.update(vehicle, this.camera, dt);
    if (snap) this.marks.clear();
    else this.marks.update(vehicle);
    this.scenery.update(this.vehicle.root.position, dt);
    if (snap) this.sparks.clear();
    else this.sparks.update(physics, dt);
    this.sun.target.position.copy(this.vehicle.root.position);
    this.sun.position.copy(this.vehicle.root.position).add({ x: -25, y: 50, z: -20 });
  }
  resize(width: number, height: number): void {
    this.cameras.resize(width, height);
  }

  updateCamera(vehicle: VehiclePhysics, dt: number, physics: PhysicsWorld, snap = false): void {
    if (!snap && physics.impactId !== this.lastImpact) this.cameras.kick(physics.impactStrength);
    this.lastImpact = physics.impactId;
    this.cameras.setMotion(vehicle.steer, vehicle.acceleration);
    this.cameras.update(this.vehicle.root, vehicle.speed, dt, physics.world, snap);
    this.vehicle.setView(this.cameras.mode);
  }

  setQuality(quality: Quality): void {
    const profile = QUALITY[quality];
    this.sun.castShadow = profile.shadow > 0;
    const size = profile.shadow || 512;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
    this.scenery.detailDistance = profile.treeDistance;
    this.smoke.emissionScale = profile.smoke;
    this.sparks.root.visible = quality !== "economy";
  }

  dispose(): void {
    this.scene.environment = null;
    this.environment.dispose();
    disposeObject(this.scene);
  }
}
