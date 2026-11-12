import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  CircleGeometry,
  TorusGeometry,
  CanvasTexture,
  PlaneGeometry,
  SRGBColorSpace,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { VEHICLE } from "./config";
import type { VehiclePhysics } from "./VehiclePhysics";
import type { CameraMode } from "../camera/config";

/** Temporary authored procedural coupe; replace with licensed GLB in the asset stage. */
export class VehicleVisual {
  readonly root = new Group();
  private readonly exterior = new Group();
  private readonly cockpit = new Group();
  private readonly bonnet = new Group();
  private readonly steeringWheel = new Group();
  private readonly needles: Group[] = [];
  private readonly pivots: Group[] = [];
  private readonly wheels: Group[] = [];
  private readonly brakeMaterial = new MeshStandardNodeMaterial({
    color: "#a21716",
    emissive: "#ff291c",
    emissiveIntensity: 0.5,
    roughness: 0.3,
  });

  constructor() {
    const paint = new MeshStandardNodeMaterial({
      color: "#bada65",
      metalness: 0.48,
      roughness: 0.27,
    });
    const glass = new MeshStandardNodeMaterial({
      color: "#152d35",
      metalness: 0.5,
      roughness: 0.18,
    });
    const carbon = new MeshStandardNodeMaterial({ color: "#182021", roughness: 0.65 });
    const alloy = new MeshStandardNodeMaterial({
      color: "#bfc9cb",
      metalness: 0.8,
      roughness: 0.24,
    });
    const stripe = new MeshStandardNodeMaterial({ color: "#eff1d9", roughness: 0.45 });
    const rubber = new MeshStandardNodeMaterial({ color: "#121719", roughness: 0.96 });
    const light = new MeshStandardNodeMaterial({
      color: "#edfaff",
      emissive: "#dcf3ff",
      emissiveIntensity: 2,
    });
    this.add(
      profileGeometry([
        [-2.1, 0.79, -0.12, 0.26],
        [-1.65, 0.98, -0.15, 0.42],
        [-0.8, 0.94, -0.14, 0.46],
        [0.8, 0.94, -0.14, 0.42],
        [1.55, 0.96, -0.1, 0.32],
        [2.13, 0.82, -0.06, 0.24],
      ]),
      paint,
      this.root,
    );
    this.add(
      profileGeometry([
        [-1.15, 0.72, 0.37, 0.42],
        [-0.55, 0.64, 0.42, 0.99],
        [0.3, 0.62, 0.4, 0.98],
        [1.03, 0.73, 0.36, 0.4],
      ]),
      glass,
      this.root,
    );
    this.box(1.29, 0.055, 0.86, paint, 0, 1.0, -0.12);
    for (const x of [-0.1, 0.1]) {
      const hoodStripe = this.box(0.09, 0.012, 1.15, stripe, x, 0.354, 1.48);
      hoodStripe.rotation.x = 0.12;
      this.box(0.09, 0.012, 0.86, stripe, x, 1.034, -0.12);
      this.box(0.09, 0.012, 0.8, stripe, x, 0.43, -1.46);
    }
    this.box(1.78, 0.1, 0.18, carbon, 0, -0.08, 2.12);
    this.box(1.8, 0.17, 0.16, carbon, 0, -0.08, -2.12);
    this.box(1.18, 0.13, 0.04, carbon, 0, 0.09, 2.145);
    for (const x of [-0.59, 0.59]) {
      this.box(0.44, 0.065, 0.07, light, x, 0.23, 2.09);
      this.box(0.58, 0.075, 0.06, this.brakeMaterial, x, 0.22, -2.12);
      this.box(0.07, 0.27, 0.12, carbon, x, 0.56, -1.76);
      this.box(0.23, 0.1, 0.28, paint, Math.sign(x) * 1.0, 0.52, 0.55);
    }
    this.box(1.96, 0.055, 0.39, carbon, 0, 0.73, -1.83);
    for (const x of [-0.97, 0.97]) this.box(0.08, 0.13, 2.6, carbon, x, -0.08, 0);
    for (const p of VEHICLE.wheelConnections) {
      const pivot = new Group(),
        wheel = new Group();
      pivot.position.set(p.x, -VEHICLE.suspension.rest, p.z);
      this.root.add(pivot);
      pivot.add(wheel);
      this.pivots.push(pivot);
      this.wheels.push(wheel);
      const tire = this.add(
        new CylinderGeometry(VEHICLE.wheelRadius, VEHICLE.wheelRadius, 0.25, 32),
        rubber,
        wheel,
      );
      tire.rotation.z = Math.PI / 2;
      const rim = this.add(new CylinderGeometry(0.245, 0.245, 0.265, 24), carbon, wheel);
      rim.rotation.z = Math.PI / 2;
      for (const side of [-1, 1]) {
        const disk = this.add(new CylinderGeometry(0.2, 0.2, 0.008, 24), alloy, wheel);
        disk.rotation.z = Math.PI / 2;
        disk.position.x = side * 0.13;
        for (let i = 0; i < 5; i++) {
          const spoke = this.add(new BoxGeometry(0.025, 0.055, 0.44), alloy, wheel);
          spoke.position.x = side * 0.143;
          spoke.rotation.x = (i * Math.PI) / 5;
        }
      }
    }
    this.root.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    for (const child of [...this.root.children]) this.exterior.add(child);
    this.root.add(this.exterior, this.cockpit, this.bonnet);
    // Development interior; replace with an authored GLB in the asset stage.
    const hood = this.add(new BoxGeometry(1.64, 0.08, 1.35), paint, this.bonnet);
    hood.position.set(0, 0.29, 1.45);
    const dash = this.add(new BoxGeometry(1.6, 0.18, 0.46), carbon, this.cockpit);
    dash.position.set(0, 0.43, 0.98);
    const panel = this.add(new BoxGeometry(0.56, 0.2, 0.04), carbon, this.cockpit);
    panel.position.set(-0.32, 0.56, 0.76);
    const dial = new MeshStandardNodeMaterial({ color: "#24332e", roughness: 0.8 });
    const needleMaterial = new MeshStandardNodeMaterial({
      color: "#ddf698",
      emissive: "#ddf698",
      emissiveIntensity: 0.8,
    });
    const tickGeometry = new BoxGeometry(0.004, 0.011, 0.003);
    for (const x of [-0.47, -0.17]) {
      const gauge = this.add(new CircleGeometry(0.075, 32), dial, this.cockpit);
      gauge.position.set(x, 0.57, 0.733);
      gauge.rotation.y = Math.PI;
      for (let i = 0; i < 11; i++) {
        const angle = -2.2 + i * 0.44;
        const tick = this.add(tickGeometry, needleMaterial, this.cockpit);
        tick.position.set(x + Math.sin(angle) * 0.064, 0.57 + Math.cos(angle) * 0.064, 0.726);
        tick.rotation.z = -angle;
      }
      const needle = new Group();
      needle.position.set(x, 0.57, 0.725);
      const bar = this.add(new BoxGeometry(0.006, 0.061, 0.004), needleMaterial, needle);
      bar.position.y = 0.025;
      this.cockpit.add(needle);
      this.needles.push(needle);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#182021";
      context.fillRect(0, 0, 512, 64);
      context.fillStyle = "#d9ef93";
      context.font = "24px monospace";
      context.textAlign = "center";
      context.fillText("RPM", 110, 42);
      context.fillText("KM/H", 400, 42);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const labels = this.add(
        new PlaneGeometry(0.52, 0.065),
        new MeshStandardNodeMaterial({ map: texture, roughness: 1 }),
        this.cockpit,
      );
      labels.position.set(-0.32, 0.475, 0.727);
      labels.rotation.y = Math.PI;
    }
    this.steeringWheel.position.set(-0.32, 0.47, 0.47);
    this.cockpit.add(this.steeringWheel);
    this.add(new TorusGeometry(0.165, 0.022, 10, 40), carbon, this.steeringWheel);
    for (const angle of [0, 2.1, -2.1]) {
      const spoke = this.add(new BoxGeometry(0.018, 0.15, 0.025), alloy, this.steeringWheel);
      spoke.position.set(Math.sin(angle) * 0.065, Math.cos(angle) * 0.065, 0);
      spoke.rotation.z = -angle;
    }
    this.add(new BoxGeometry(0.065, 0.05, 0.04), carbon, this.steeringWheel);
    this.setView("chase");
  }

  private add(geometry: BufferGeometry, material: MeshStandardNodeMaterial, parent: Group): Mesh {
    const mesh = new Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }
  private box(
    w: number,
    h: number,
    d: number,
    material: MeshStandardNodeMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const mesh = this.add(new BoxGeometry(w, h, d), material, this.root);
    mesh.position.set(x, y, z);
    return mesh;
  }

  update(vehicle: VehiclePhysics, alpha: number): void {
    this.root.position.lerpVectors(vehicle.previousPosition, vehicle.position, alpha);
    this.root.quaternion.slerpQuaternions(vehicle.previousRotation, vehicle.rotation, alpha);
    const steer = vehicle.previousSteer + (vehicle.steer - vehicle.previousSteer) * alpha;
    this.pivots.forEach((pivot, i) => {
      pivot.position.y = -(
        vehicle.previousWheelLengths[i] +
        (vehicle.wheelLengths[i] - vehicle.previousWheelLengths[i]) * alpha
      );
      pivot.rotation.y = i < 2 ? steer : 0;
      this.wheels[i].rotation.x =
        vehicle.previousWheelAngles[i] +
        (vehicle.wheelAngles[i] - vehicle.previousWheelAngles[i]) * alpha;
    });
    this.steeringWheel.rotation.z = steer * 3;
    this.needles[0].rotation.z = 2.2 - (vehicle.rpm / 7500) * 4.4;
    this.needles[1].rotation.z = 2.2 - Math.min(1, (Math.abs(vehicle.speed) * 3.6) / 240) * 4.4;
    this.brakeMaterial.emissiveIntensity =
      vehicle.brake > 0.05 || vehicle.handbrake > 0.05 ? 3 : 0.5;
  }

  setView(mode: CameraMode): void {
    this.exterior.visible = mode === "chase";
    this.cockpit.visible = mode === "cockpit";
    this.bonnet.visible = mode === "cockpit" || mode === "hood";
  }
}

function profileGeometry(sections: number[][]): BufferGeometry {
  const vertices: number[] = [],
    indices: number[] = [];
  sections.forEach(([z, w, bottom, top], i) => {
    vertices.push(-w, bottom, z, w, bottom, z, w, top, z, -w, top, z);
    if (i > 0)
      for (let side = 0; side < 4; side++) {
        const a = (i - 1) * 4 + side,
          b = (i - 1) * 4 + ((side + 1) % 4),
          c = i * 4 + side,
          d = i * 4 + ((side + 1) % 4);
        indices.push(a, b, c, b, d, c);
      }
  });
  const last = (sections.length - 1) * 4;
  indices.push(0, 3, 1, 1, 3, 2, last, last + 1, last + 3, last + 1, last + 2, last + 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
