import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { VEHICLE } from "./config";
import type { VehiclePhysics } from "./VehiclePhysics";

/** Temporary authored procedural coupe; replace with licensed GLB in the asset stage. */
export class VehicleVisual {
  readonly root = new Group();
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
    const spin =
      vehicle.previousWheelAngle + (vehicle.wheelAngle - vehicle.previousWheelAngle) * alpha;
    this.pivots.forEach((pivot, i) => {
      pivot.position.y = -(
        vehicle.previousWheelLengths[i] +
        (vehicle.wheelLengths[i] - vehicle.previousWheelLengths[i]) * alpha
      );
      pivot.rotation.y = i < 2 ? steer : 0;
      this.wheels[i].rotation.x = spin;
    });
    this.brakeMaterial.emissiveIntensity = vehicle.brake > 0.05 ? 3 : 0.5;
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
