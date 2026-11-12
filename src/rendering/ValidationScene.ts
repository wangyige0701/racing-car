import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  BufferGeometry,
  Material,
} from "three/webgpu";
import { color, mix, positionLocal, positionWorld, smoothstep, sin } from "three/tsl";

/** Deliberately a calibration scene, not a placeholder advertised as a finished vehicle. */
export class ValidationScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.1, 100);
  readonly ball: Mesh;

  constructor() {
    this.scene.background = new Color("#b8c4b0");
    this.scene.fog = new Fog("#b8c4b0", 24, 65);
    this.camera.position.set(10.5, 9, 13.5);
    this.camera.lookAt(0, 0.9, 0);
    this.scene.add(new HemisphereLight("#f8ffe8", "#4b6148", 3));
    const sun = new DirectionalLight("#fff2cb", 4.5);
    sun.position.set(-5, 12, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 13;
    sun.shadow.camera.bottom = -13;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 40;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);

    const floorMaterial = new MeshStandardNodeMaterial({ roughness: 0.95 });
    const gridX = smoothstep(0.965, 0.99, sin(positionWorld.x.mul(Math.PI)).abs());
    const gridZ = smoothstep(0.965, 0.99, sin(positionWorld.z.mul(Math.PI)).abs());
    floorMaterial.colorNode = mix(color("#a3af9c"), color("#8d9d85"), gridX.max(gridZ).mul(0.34));
    const floor = this.mesh(new PlaneGeometry(160, 160), floorMaterial, 0, -0.025, 0);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;

    const padMaterial = new MeshStandardNodeMaterial({
      color: "#374539",
      metalness: 0.35,
      roughness: 0.6,
    });
    const pad = this.mesh(new CylinderGeometry(3.8, 3.9, 0.25, 96), padMaterial, 0, 0.125, 0);
    pad.receiveShadow = true;
    pad.castShadow = true;
    const lime = new MeshStandardNodeMaterial({
      color: "#dcf78b",
      roughness: 0.45,
      emissive: "#a4c453",
      emissiveIntensity: 0.12,
    });
    const marking = new MeshStandardNodeMaterial({ color: "#c4d1b4", roughness: 0.7 });
    for (const radius of [1.25, 2.8, 3.65]) {
      const ring = this.mesh(
        new TorusGeometry(radius, radius === 3.65 ? 0.022 : 0.009, 6, 128),
        radius === 3.65 ? lime : marking,
        0,
        0.262,
        0,
      );
      ring.rotation.x = -Math.PI / 2;
    }
    const tickGeometry = new BoxGeometry(0.018, 0.009, 0.2);
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2;
      const tick = this.mesh(
        tickGeometry,
        marking,
        Math.sin(angle) * 3.32,
        0.26,
        Math.cos(angle) * 3.32,
      );
      tick.rotation.y = angle;
    }

    const ballMaterial = new MeshStandardNodeMaterial({ metalness: 0.38, roughness: 0.24 });
    const stripe = smoothstep(0.1, 0.13, positionLocal.y.abs());
    ballMaterial.colorNode = mix(color("#d9f77a"), color("#263e33"), stripe);
    this.ball = this.mesh(new SphereGeometry(0.65, 64, 40), ballMaterial, 0, 4, 0);
    this.ball.castShadow = true;
    this.ball.receiveShadow = true;

    const dark = new MeshStandardNodeMaterial({
      color: "#2f4337",
      roughness: 0.65,
      metalness: 0.25,
    });
    for (const [x, z] of [
      [-4.8, -3.7],
      [4.8, -3.7],
      [-4.8, 3.7],
      [4.8, 3.7],
    ]) {
      const post = this.mesh(new BoxGeometry(0.2, 0.9, 0.2), dark, x, 0.45, z);
      post.castShadow = true;
      this.mesh(new BoxGeometry(0.21, 0.08, 0.21), lime, x, 0.8, z);
    }
    for (const z of [-6.2, 6.2]) {
      this.mesh(new BoxGeometry(10, 0.005, 0.035), marking, 0, 0.005, z);
      for (let i = 0; i < 5; i++) {
        const dash = this.mesh(
          new BoxGeometry(0.42, 0.005, 0.24),
          dark,
          3.6 + i * 0.24,
          0.01,
          z + 0.4,
        );
        dash.rotation.y = -Math.PI / 4;
      }
    }
  }

  private mesh(
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    return mesh;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 1 ? 48 : 38;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      }
      if (object instanceof DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.scene.clear();
  }
}
