import {
  Box3,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three/webgpu";
import type { Object3D } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { disposeObject } from "../rendering/dispose";
import { CAR_ASSET } from "./asset";
import { VEHICLE } from "./config";
import type { VehiclePhysics } from "./VehiclePhysics";
import type { CameraMode } from "../camera/config";

/** Licensed, authored GLB with explicit animation bindings; no placeholder fallback. */
export class VehicleVisual {
  readonly root = new Group();
  private readonly pivots: Group[] = [];
  private readonly wheels: Group[] = [];
  private readonly steering = new Group();
  private readonly brakeMaterials = new Set<MeshStandardMaterial>();
  private readonly glass: Object3D[] = [];
  private readonly screenCanvas = document.createElement("canvas");
  private readonly screenTexture: CanvasTexture;
  private screenState = "";

  static async load(signal: AbortSignal): Promise<VehicleVisual> {
    const response = await fetch(CAR_ASSET.url, { signal });
    if (!response.ok) throw new Error(`车辆 GLB 加载失败（${response.status}），请重试。`);
    const buffer = await response.arrayBuffer();
    signal.throwIfAborted();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(buffer, "");
    if (signal.aborted) {
      disposeObject(gltf.scene);
      signal.throwIfAborted();
    }
    try {
      return new VehicleVisual(gltf.scene);
    } catch (error) {
      disposeObject(gltf.scene);
      throw error;
    }
  }

  private constructor(model: Group) {
    this.root.name = "PlayerVehicle";
    model.name = "CarConceptGLB";
    model.scale.setScalar(CAR_ASSET.scale);
    model.position.set(0, CAR_ASSET.offsetY, CAR_ASSET.offsetZ);
    this.root.add(model);
    this.root.updateMatrixWorld(true);
    const required = (name: string) => {
      const node = model.getObjectByName(name);
      if (!node) throw new Error(`车辆资产缺少可动节点：${name}`);
      return node;
    };
    // Validate the complete contract before reparenting shared GLB nodes.
    const wheelNodes = CAR_ASSET.wheels.map(required);
    const wheelParts = [
      "InteriorSteeringWheel01",
      "InteriorSteeringWheel02",
      "InteriorSteeringWheel03",
      "InteriorSteeringWheel04",
      "InteriorSteeringEmblem",
    ].map(required);
    required("InteriorSteeringDash");

    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        if (material.name.startsWith("Paint 1")) {
          material.color.set("#a9ce52");
          material.metalness = 0.72;
          material.roughness = 0.3;
          if (material instanceof MeshPhysicalMaterial) {
            material.clearcoat = 1;
            material.clearcoatRoughness = 0.12;
          }
        }
        if (material.name.startsWith("Paint 2")) material.color.set("#222e2c");
        if (material.name === "Brakelight") {
          material.emissive.set("#ff1810");
          material.emissiveIntensity = 0.5;
          this.brakeMaterials.add(material);
        }
        if (material.name === "Glass") {
          if (material instanceof MeshPhysicalMaterial) material.transmission = 0;
          material.transparent = true;
          material.opacity = 0.18;
          material.depthWrite = false;
          material.color.set("#b3d4d5");
          material.roughness = 0.16;
          material.side = DoubleSide;
          object.castShadow = false;
          this.glass.push(object);
        }
        if (material.name === "Dashboard") material.emissiveIntensity = 0.8;
      }
    });

    wheelNodes.forEach((wheel, i) => {
      const pivot = new Group();
      pivot.name = `Suspension_${i}`;
      wheel.getWorldPosition(pivot.position);
      this.root.add(pivot);
      const rolling = new Group();
      pivot.add(rolling);
      rolling.attach(wheel);
      // The source is displayed with its front wheels steered 30 degrees.
      if (i < 2)
        wheel.quaternion.premultiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6),
        );
      const radiusScale = VEHICLE.wheelRadius / (0.383759 * CAR_ASSET.scale);
      wheel.scale.multiplyScalar(radiusScale);
      this.root.updateMatrixWorld(true);
      const caliper = wheel.getObjectByName(`${CAR_ASSET.wheels[i]}BrakePad`);
      if (caliper) pivot.attach(caliper); // Calipers steer and suspend, but never roll.
      const p = VEHICLE.wheelConnections[i];
      pivot.position.set(p.x, -VEHICLE.suspension.rest, p.z);
      this.pivots.push(pivot);
      this.wheels.push(rolling);
    });

    // The model preparation step moves this assembly +0.42 m into the left seat.
    this.steering.name = "AnimatedSteering";
    this.steering.position.set(
      CAR_ASSET.driverX,
      0.642 * CAR_ASSET.scale + CAR_ASSET.offsetY,
      0.929 * CAR_ASSET.scale + CAR_ASSET.offsetZ,
    );
    this.steering.rotation.x = 0.38;
    this.root.add(this.steering);
    this.root.updateMatrixWorld(true);
    for (const part of wheelParts) this.steering.attach(part);

    // A small in-car telemetry display replaces the source's static graphic.
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 192;
    this.screenTexture = new CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = SRGBColorSpace;
    const screen = new Mesh(
      new PlaneGeometry(0.31, 0.116),
      new MeshBasicNodeMaterial({ map: this.screenTexture, toneMapped: false }),
    );
    screen.name = "LiveDashboard";
    screen.position.set(
      CAR_ASSET.driverX,
      0.755 * CAR_ASSET.scale + CAR_ASSET.offsetY,
      1.205 * CAR_ASSET.scale + CAR_ASSET.offsetZ - 0.015,
    );
    screen.rotation.y = Math.PI;
    this.root.add(screen);
    this.root.userData.modelBounds = new Box3()
      .setFromObject(model, true)
      .getSize(new Vector3())
      .toArray();
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
    // Remove the source's 15-degree steering presentation pose at neutral input.
    this.steering.rotation.set(0.38, 0, -Math.PI / 12 - steer * 2.8);
    this.brakeMaterials.forEach((material) => {
      material.emissiveIntensity = vehicle.brake > 0.05 || vehicle.handbrake > 0.05 ? 4 : 0.5;
    });
    const speed = Math.round(Math.abs(vehicle.speed) * 3.6);
    const rpm = Math.round(vehicle.rpm / 100) * 100;
    const key = `${speed}/${rpm}/${vehicle.gear}`;
    if (key !== this.screenState) {
      this.screenState = key;
      const ctx = this.screenCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#081314";
        ctx.fillRect(0, 0, 512, 192);
        ctx.fillStyle = "#d8f58b";
        ctx.font = "bold 92px monospace";
        ctx.fillText(String(speed).padStart(3, "0"), 25, 116);
        ctx.font = "26px monospace";
        ctx.fillStyle = "#a5b7bb";
        ctx.fillText("KM/H", 200, 112);
        ctx.fillText(`${rpm} RPM`, 28, 166);
        ctx.font = "bold 78px monospace";
        ctx.fillStyle = "#f3f5e4";
        ctx.fillText(vehicle.gear === -1 ? "R" : String(vehicle.gear), 414, 113);
        ctx.fillStyle = "#31433c";
        ctx.fillRect(24, 18, 464, 12);
        ctx.fillStyle = rpm > 6500 ? "#ff7848" : "#cde982";
        ctx.fillRect(24, 18, (464 * rpm) / 7500, 12);
        this.screenTexture.needsUpdate = true;
      }
    }
  }

  setView(mode: CameraMode): void {
    // Keep the real body, A-pillars, mirrors and cabin. Only omit glass in the
    // driver's view to avoid stacked transparent surfaces obscuring the road.
    this.glass.forEach((object) => {
      object.visible = mode !== "cockpit";
    });
  }
}
