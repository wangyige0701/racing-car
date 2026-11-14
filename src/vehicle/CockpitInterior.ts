import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Path,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three/webgpu";
import type { Material } from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { COCKPIT } from "./cockpitLayout";

/** 第一人称内饰总成。外观 GLB 保留，驾驶舱内不叠加原有概念车仪表和座椅。 */
export class CockpitInterior {
  readonly root = new Group();

  constructor(texture: CanvasTexture) {
    this.root.name = "CockpitInterior";
    const grain = leatherGrain();
    const trim = new MeshStandardNodeMaterial({
      color: "#242b2c",
      roughness: 0.88,
      bumpMap: grain,
      bumpScale: 0.001,
    });
    const upper = new MeshStandardNodeMaterial({
      color: "#171e20",
      roughness: 0.96,
      bumpMap: grain,
      bumpScale: 0.0015,
    });
    const leather = new MeshStandardNodeMaterial({
      color: "#39433d",
      roughness: 0.85,
      bumpMap: grain,
      bumpScale: 0.001,
    });
    const metal = new MeshStandardNodeMaterial({
      color: "#697571",
      metalness: 0.65,
      roughness: 0.4,
    });
    const rubber = new MeshStandardNodeMaterial({ color: "#090e0f", roughness: 1 });
    const mesh = (
      name: string,
      geometry: BufferGeometry,
      material: Material,
      parent = this.root,
    ) => {
      const object = new Mesh(geometry, material);
      object.name = name;
      // 车内避免低分辨率外部阴影在近距离仪表上形成锯齿；依然接受场景光照。
      object.castShadow = object.receiveShadow = false;
      parent.add(object);
      return object;
    };
    const box = (
      name: string,
      size: [number, number, number],
      position: [number, number, number],
      material: Material,
    ) => {
      const object = mesh(
        name,
        new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.15),
        material,
      );
      object.position.fromArray(position);
      return object;
    };
    const beam = (
      name: string,
      from: Vector3,
      to: Vector3,
      width: number,
      depth: number,
      material: Material,
    ) => {
      const delta = to.clone().sub(from);
      const object = mesh(
        name,
        new RoundedBoxGeometry(width, delta.length(), depth, 2, 0.008),
        material,
      );
      object.position.copy(from).addScaledVector(delta, 0.5);
      object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
      return object;
    };
    const { lower, upper: top } = COCKPIT.windshield;
    for (const side of [-1, 1]) {
      const a = new Vector3(side * lower.x, lower.y, lower.z);
      const b = new Vector3(side * top.x, top.y, top.z);
      beam(`CockpitAPillar${side > 0 ? "Left" : "Right"}`, a, b, 0.075, 0.065, trim);
      beam(
        `WindshieldSeal${side}`,
        a.clone().add(new Vector3(-side * 0.041, 0, 0)),
        b.clone().add(new Vector3(-side * 0.041, 0, 0)),
        0.012,
        0.023,
        rubber,
      );
      beam(`RoofSideRail${side}`, b, new Vector3(side * 0.91, 0.94, -0.85), 0.085, 0.07, trim);
      beam(`DoorSill${side}`, a, new Vector3(side * 1.02, 0.02, -0.8), 0.07, 0.085, upper);
      // 门板上沿跟随倾斜窗台，不能用等高箱体留下能看见路面的三角缝。
      const doorSection = new Shape();
      doorSection.moveTo(-0.84, -0.6);
      doorSection.lineTo(1.2, -0.6);
      doorSection.lineTo(1.2, lower.y);
      doorSection.lineTo(-0.84, 0.02);
      doorSection.closePath();
      const doorGeometry = new ExtrudeGeometry(doorSection, { depth: 0.1, bevelEnabled: false });
      doorGeometry.rotateY(-Math.PI / 2);
      doorGeometry.translate(side * 1.02 + 0.05, 0, 0);
      mesh(`DoorPanel${side}`, doorGeometry, trim);
      beam(
        `MirrorMount${side}`,
        new Vector3(side * 1.06, 0.14, COCKPIT.mirror.z + 0.04),
        new Vector3(side * 1.15, 0.16, COCKPIT.mirror.z + 0.04),
        0.035,
        0.04,
        rubber,
      );
      box(`DoorArmrest${side}`, [0.13, 0.065, 0.65], [side * 0.98, -0.15, -0.05], leather);
      box(`DoorHandle${side}`, [0.025, 0.035, 0.16], [side * 0.995, -0.04, 0.24], metal);
    }
    box("CockpitWindshieldHeader", [1.82, 0.075, 0.095], [0, top.y, top.z], trim);
    box("CockpitRoofLining", [1.82, 0.055, 1], [0, top.y + 0.03, -0.38], upper);
    box("WindshieldCowl", [2.04, 0.07, 0.12], [0, lower.y - 0.035, lower.z], upper);

    // 风挡反射面与 A 柱共用四个端点；不用覆盖整屏的模糊层，也不覆盖内饰。
    const glassGeometry = new BufferGeometry();
    glassGeometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        [
          -lower.x,
          lower.y,
          lower.z,
          lower.x,
          lower.y,
          lower.z,
          -top.x,
          top.y,
          top.z,
          top.x,
          top.y,
          top.z,
        ],
        3,
      ),
    );
    glassGeometry.setIndex([0, 1, 2, 2, 1, 3]);
    glassGeometry.computeVertexNormals();
    mesh(
      "CockpitWindshieldGlass",
      glassGeometry,
      new MeshStandardNodeMaterial({
        color: "#b8d5ce",
        transparent: true,
        opacity: 0.045,
        roughness: 0.25,
        metalness: 0.15,
        depthWrite: false,
        side: DoubleSide,
      }),
    );

    // 挤出的连续仪表台截面从驾驶员面板延伸到风挡根部，不是悬空的矩形容器。
    const section = new Shape();
    section.moveTo(0.46, -0.34);
    section.lineTo(1.22, -0.34);
    section.lineTo(1.22, 0.12);
    section.quadraticCurveTo(0.95, 0.1, 0.68, -0.03);
    section.quadraticCurveTo(0.5, -0.04, 0.46, -0.14);
    section.closePath();
    const dashGeometry = new ExtrudeGeometry(section, {
      depth: 2.04,
      bevelEnabled: false,
      curveSegments: 18,
    });
    // 截面的 x/y 对应车身 z/y，挤出方向对应横向 x。
    dashGeometry.rotateY(-Math.PI / 2);
    dashGeometry.translate(1.02, 0, 0);
    mesh("ContinuousDashboard", dashGeometry, upper);
    box("DashboardLowerFascia", [1.96, 0.12, 0.08], [0, -0.18, 0.49], leather);
    box("DashboardTrim", [1.96, 0.008, 0.012], [0, -0.105, 0.444], metal);
    box("CentreConsole", [0.26, 0.24, 0.88], [-0.12, -0.38, 0.12], trim);
    box("CockpitFloor", [2.1, 0.05, 2.1], [0, -0.6, 0.12], upper);
    beam(
      "SteeringColumn",
      new Vector3(COCKPIT.steering.x, -0.1, 0.4),
      new Vector3(COCKPIT.steering.x, -0.16, 0.65),
      0.085,
      0.08,
      rubber,
    );
    for (const x of [-0.82, -0.25, 0.08, 0.88]) {
      box(`VentHousing${x}`, [0.16, 0.055, 0.018], [x, -0.055, 0.474], rubber);
      for (let i = 0; i < 3; i++)
        box(`VentSlat${x}_${i}`, [0.14, 0.003, 0.021], [x, -0.073 + i * 0.018, 0.46], metal);
    }

    const instrument = new Group();
    instrument.name = "IntegratedInstrumentCluster";
    instrument.position.set(COCKPIT.instrument.x, COCKPIT.instrument.y, COCKPIT.instrument.z);
    instrument.rotation.set(COCKPIT.instrument.tilt, Math.PI, 0);
    this.root.add(instrument);
    // 仪表下沿以弧面过渡到主台面，避免下方形成外贴卡片般的宽平边框。
    const pedestal = new Shape();
    pedestal.moveTo(0.56, -0.18);
    pedestal.lineTo(1.03, -0.18);
    pedestal.lineTo(1.03, 0.17);
    pedestal.quadraticCurveTo(0.87, 0.18, 0.77, 0.09);
    pedestal.quadraticCurveTo(0.67, 0.02, 0.56, -0.06);
    pedestal.closePath();
    const pedestalGeometry = new ExtrudeGeometry(pedestal, {
      depth: 0.55,
      bevelEnabled: false,
      curveSegments: 16,
    });
    pedestalGeometry.rotateY(-Math.PI / 2);
    pedestalGeometry.translate(COCKPIT.instrument.x + 0.275, -0.06, 0);
    mesh("InstrumentDashboardBlend", pedestalGeometry, upper);
    const width = 0.44,
      height = 0.165;
    const aperture = roundedRectangle(width, height, 0.018);
    const surround = new Shape();
    surround.moveTo(-0.272, -0.115);
    surround.lineTo(-0.272, 0.05);
    surround.quadraticCurveTo(-0.265, 0.13, -0.19, 0.135);
    surround.lineTo(0.19, 0.135);
    surround.quadraticCurveTo(0.265, 0.13, 0.272, 0.05);
    surround.lineTo(0.272, -0.115);
    surround.closePath();
    surround.holes.push(new Path(aperture.getPoints(12).reverse()));
    const hood = new ExtrudeGeometry(surround, {
      depth: 0.18,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.006,
      bevelThickness: 0.006,
      curveSegments: 16,
    });
    hood.translate(0, 0, -0.18);
    mesh("LiveDashboardBezel", hood, upper, instrument);
    const backing = mesh(
      "InstrumentBacking",
      new BoxGeometry(0.45, 0.175, 0.02),
      rubber,
      instrument,
    );
    backing.position.z = -0.035;
    const screenGeometry = new ShapeGeometry(aperture, 16);
    const positions = screenGeometry.getAttribute("position");
    const uv = screenGeometry.getAttribute("uv");
    for (let i = 0; i < positions.count; i++)
      uv.setXY(i, positions.getX(i) / width + 0.5, positions.getY(i) / height + 0.5);
    const screen = mesh(
      "LiveDashboard",
      screenGeometry,
      new MeshBasicNodeMaterial({
        map: texture,
        toneMapped: false,
      }),
      instrument,
    );
    // 实际屏面位于开孔内侧 12 mm，边框厚度自然遮挡斜视边缘，无透明叠片。
    screen.position.z = -0.012;
    this.root.visible = false;
  }
}

function roundedRectangle(width: number, height: number, radius: number): Shape {
  const x = width / 2,
    y = height / 2;
  const shape = new Shape();
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shape;
}

/** 小型可复现皮纹只用于凹凸，不引入外部位图资产或逐帧纹理分配。 */
function leatherGrain(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(128, 128);
  let seed = 319;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 80 + (seed >>> 26);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(12, 12);
  texture.anisotropy = 4;
  return texture;
}
