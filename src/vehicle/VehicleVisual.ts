import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
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

/** 已授权的原始 GLB，具有明确动画绑定；不提供占位回退。 */
export class VehicleVisual {
  readonly root = new Group();
  private readonly pivots: Group[] = [];
  private readonly wheels: Group[] = [];
  private readonly steering = new Group();
  private readonly cockpitFrame = new Group();
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
    this.cockpitFrame.name = "CockpitWindshieldFrame";
    const frameMaterial = new MeshStandardMaterial({
      color: "#101714",
      metalness: 0.35,
      roughness: 0.3,
    });
    const addPillar = (name: string, x: number) => {
      const lower = new Vector3(x, -0.04, 1.07);
      const upper = new Vector3(x, 1.08, 0.78);
      const direction = upper.clone().sub(lower);
      const pillar = new Mesh(
        new CylinderGeometry(0.03, 0.044, direction.length(), 10),
        frameMaterial,
      );
      pillar.name = name;
      pillar.position.copy(lower).addScaledVector(direction, 0.5);
      pillar.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
      pillar.castShadow = false;
      pillar.receiveShadow = false;
      this.cockpitFrame.add(pillar);
    };
    addPillar("CockpitAPillarLeft", 0.76);
    addPillar("CockpitAPillarRight", -0.76);
    const header = new Mesh(new BoxGeometry(1.58, 0.048, 0.052), frameMaterial);
    header.name = "CockpitWindshieldHeader";
    header.position.set(0, 1.08, 0.78);
    header.castShadow = false;
    header.receiveShadow = false;
    this.cockpitFrame.add(header);
    this.cockpitFrame.visible = false;
    this.root.add(this.cockpitFrame);
    this.root.updateMatrixWorld(true);
    const required = (name: string) => {
      const node = model.getObjectByName(name);
      if (!node) throw new Error(`车辆资产缺少可动节点：${name}`);
      return node;
    };
    // 重新挂载共享 GLB 节点前，先校验完整契约。
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
      // 源模型展示时前轮带有 30 度转向角。
      if (i < 2)
        wheel.quaternion.premultiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6),
        );
      const radiusScale = VEHICLE.wheelRadius / (0.383759 * CAR_ASSET.scale);
      wheel.scale.multiplyScalar(radiusScale);
      this.root.updateMatrixWorld(true);
      const caliper = wheel.getObjectByName(`${CAR_ASSET.wheels[i]}BrakePad`);
      if (caliper) pivot.attach(caliper); // 卡钳随转向和悬挂运动，但不随车轮滚动。
      const p = VEHICLE.wheelConnections[i];
      pivot.position.set(p.x, -VEHICLE.suspension.rest, p.z);
      this.pivots.push(pivot);
      this.wheels.push(rolling);
    });

    // 模型预处理步骤将该总成向左座移动了 +0.42 米。
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

    // 以车内小型遥测屏替代源模型的静态图案。
    this.screenCanvas.width = 768;
    this.screenCanvas.height = 288;
    this.screenTexture = new CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = SRGBColorSpace;
    const dashboardPosition = new Vector3(
      CAR_ASSET.driverX,
      0.742 * CAR_ASSET.scale + CAR_ASSET.offsetY,
      1.222 * CAR_ASSET.scale + CAR_ASSET.offsetZ,
    );
    const bezelShape = new Shape();
    bezelShape.moveTo(-0.176, -0.072);
    bezelShape.lineTo(-0.147, -0.095);
    bezelShape.lineTo(0.147, -0.095);
    bezelShape.lineTo(0.176, -0.072);
    bezelShape.lineTo(0.164, 0.075);
    bezelShape.lineTo(-0.164, 0.075);
    bezelShape.closePath();
    const displayCutout = new Path();
    displayCutout.moveTo(-0.145, 0.042);
    displayCutout.lineTo(-0.137, 0.05);
    displayCutout.lineTo(0.137, 0.05);
    displayCutout.lineTo(0.145, -0.043);
    displayCutout.lineTo(0.137, -0.051);
    displayCutout.lineTo(-0.137, -0.051);
    displayCutout.closePath();
    bezelShape.holes.push(displayCutout);
    const displayBezel = new Mesh(
      new ShapeGeometry(bezelShape),
      new MeshStandardMaterial({
        color: "#111916",
        metalness: 0.5,
        roughness: 0.35,
        side: DoubleSide,
      }),
    );
    displayBezel.name = "LiveDashboardBezel";
    displayBezel.position.copy(dashboardPosition);
    displayBezel.position.z -= 0.008;
    displayBezel.rotation.set(-0.08, Math.PI, 0);
    this.root.add(displayBezel);
    const screen = new Mesh(
      new PlaneGeometry(0.276, 0.101),
      new MeshBasicNodeMaterial({ map: this.screenTexture, toneMapped: false, transparent: true }),
    );
    screen.name = "LiveDashboard";
    screen.position.copy(dashboardPosition);
    screen.position.z -= 0.004;
    screen.rotation.set(-0.08, Math.PI, 0);
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
    // 在中性输入时移除源模型用于展示的 15 度方向盘姿态。
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
        const background = ctx.createLinearGradient(0, 0, 768, 288);
        background.addColorStop(0, "#0d1714");
        background.addColorStop(0.68, "#040a08");
        background.addColorStop(1, "#101b15");
        ctx.clearRect(0, 0, 768, 288);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(8, 8, 752, 272, 22);
        ctx.clip();
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, 768, 288);
        ctx.strokeStyle = "#b5cc8d35";
        ctx.lineWidth = 2;
        ctx.strokeRect(10, 10, 748, 268);
        ctx.fillStyle = "#d8f58b";
        ctx.fillRect(26, 28, 182, 5);
        ctx.fillStyle = "#9ba996";
        ctx.font = "16px Consolas, monospace";
        ctx.fillText("SPEED", 28, 59);
        ctx.font = "bold 132px Consolas, monospace";
        ctx.fillStyle = "#edf5d9";
        ctx.fillText(String(speed).padStart(3, "0"), 24, 184);
        ctx.font = "23px Consolas, monospace";
        ctx.fillStyle = "#aebda8";
        ctx.fillText("KM/H", 342, 174);
        ctx.fillStyle = "#ffffff18";
        ctx.fillRect(480, 34, 2, 160);
        ctx.fillStyle = "#9ba996";
        ctx.font = "16px Consolas, monospace";
        ctx.fillText("GEAR", 536, 59);
        ctx.font = "bold 108px Consolas, monospace";
        ctx.fillStyle = "#d8f58b";
        ctx.fillText(vehicle.gear === -1 ? "R" : String(vehicle.gear), 560, 176);
        ctx.fillStyle = "#1f342c";
        ctx.fillRect(26, 216, 716, 10);
        const segments = 18;
        const activeSegments = Math.round((Math.min(rpm, 7500) / 7500) * segments);
        for (let i = 0; i < segments; i++) {
          ctx.fillStyle = i < activeSegments ? (i > 14 ? "#f08c62" : "#d8f58b") : "#385044";
          ctx.fillRect(26 + i * 40, 216, 31, 10);
        }
        ctx.font = "18px Consolas, monospace";
        ctx.fillStyle = "#aebda8";
        ctx.fillText(`${rpm.toString().padStart(4, "0")} RPM`, 28, 260);
        ctx.fillStyle = "#d8f58b";
        ctx.fillText("AUTO", 645, 260);
        ctx.restore();
        this.screenTexture.needsUpdate = true;
      }
    }
  }

  setView(mode: CameraMode): void {
    // 原模型玻璃包含覆盖座舱的多层面；驾驶舱改用单独的风挡反射层，避免内饰发糊。
    this.glass.forEach((object) => {
      object.visible = mode !== "cockpit";
    });
    this.cockpitFrame.visible = mode === "cockpit";
  }
}
