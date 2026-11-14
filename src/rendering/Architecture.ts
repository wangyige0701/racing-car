import { BoxGeometry, BufferGeometry, Group, Mesh, MeshStandardNodeMaterial } from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** 以米为单位制作的模块化建筑；实例化前按材质合并几何体。 */
export function buildingModel(
  concrete: MeshStandardNodeMaterial,
  floors: number,
  balconies: boolean,
): Group {
  const root = new Group();
  const materials = [
    concrete,
    new MeshStandardNodeMaterial({ color: "#263e4c", metalness: 0.55, roughness: 0.22 }),
    new MeshStandardNodeMaterial({ color: "#666c6d", metalness: 0.75, roughness: 0.48 }),
    new MeshStandardNodeMaterial({ color: balconies ? "#73675b" : "#c2c3bc", roughness: 0.86 }),
  ];
  const parts: BufferGeometry[][] = materials.map(() => []);
  const box = (
    material: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => parts[material].push(new BoxGeometry(w, h, d).translate(x, y, z));
  const height = floors * 3.2 + 4;
  box(0, 0, height / 2, 0, 18, height, 20);
  box(3, 0, 0.2, 0, 20, 0.4, 22);
  // 深窗框凹槽、楼层挑檐、首层店铺玻璃和立柱。
  for (const side of [-1, 1]) {
    for (let floor = 0; floor <= floors; floor++) {
      const y = floor === 0 ? 1.9 : 4 + (floor - 0.5) * 3.2;
      for (let column = 0; column < 5; column++) {
        const x = -7.1 + column * 3.55;
        box(2, x, y, side * 10.06, 2.8, 2.35, 0.16);
        box(1, x, y, side * 10.16, 2.52, 2.06, 0.05);
        box(2, x, y, side * 10.21, 0.055, 2.1, 0.065);
        if (balconies && floor > 0 && column % 2 === 0) {
          box(0, x, y - 1.25, side * 10.7, 3.1, 0.16, 1.5);
          box(2, x, y - 0.45, side * 11.4, 3, 0.055, 0.06);
          for (let rail = 0; rail < 7; rail++)
            box(2, x - 1.45 + rail * 0.48, y - 0.83, side * 11.4, 0.035, 0.78, 0.035);
        }
      }
      box(3, 0, y + 1.45, side * 10.12, 18.35, 0.18, 0.35);
      for (let bay = 0; bay < 5; bay++) {
        const z = -8 + bay * 4;
        box(2, side * 9.06, y, z, 0.16, 2.35, 2.6);
        box(1, side * 9.16, y, z, 0.05, 2.06, 2.34);
      }
    }
    for (let i = 0; i < 6; i++) box(0, -8.8 + i * 3.52, 1.8, side * 10.38, 0.28, 3.6, 0.42);
    // 屋顶女儿墙和立面落水管具有真实深度并投射阴影。
    box(0, 0, height + 0.45, side * 9.8, 18, 0.9, 0.3);
    box(0, side * 8.8, height + 0.45, 0, 0.3, 0.9, 20);
    box(2, side * 8.7, height / 2, 10.45, 0.12, height, 0.12);
  }
  box(3, 0, height + 0.08, 0, 18.4, 0.16, 20.4);
  box(0, -3.5, height + 1.4, -3, 4, 2.8, 4);
  for (const x of [1, 5]) {
    box(2, x, height + 0.65, 1, 2.5, 1.2, 3);
    for (let i = 0; i < 6; i++) box(1, x - 1 + i * 0.4, height + 1.28, 1, 0.14, 0.04, 2.7);
  }
  parts.forEach((geometries, i) => {
    const mesh = new Mesh(mergeGeometries(geometries)!, materials[i]);
    geometries.forEach((geometry) => geometry.dispose());
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  });
  return root;
}

export function pitBuilding(concrete: MeshStandardNodeMaterial): Group {
  const root = new Group();
  const steel = new MeshStandardNodeMaterial({
    color: "#667375",
    roughness: 0.55,
    metalness: 0.65,
  });
  const glass = new MeshStandardNodeMaterial({ color: "#243a45", roughness: 0.2, metalness: 0.5 });
  const parts: BufferGeometry[][] = [[], [], []];
  const box = (m: number, x: number, y: number, z: number, w: number, h: number, d: number) =>
    parts[m].push(new BoxGeometry(w, h, d).translate(x, y, z));
  box(0, 0, 3.2, 0, 12, 6.4, 34);
  box(0, 0, -0.1, 0, 20, 0.2, 40);
  box(1, 0, 6.5, 0, 13, 0.22, 35);
  for (let i = 0; i < 6; i++) {
    const z = -13 + i * 5.2;
    box(1, -6.12, 1.8, z, 0.18, 3.6, 4.2);
    for (let slat = 0; slat < 13; slat++) box(0, -6.24, 0.25 + slat * 0.26, z, 0.035, 0.04, 4.02);
    box(0, -6.25, 2, z - 2.3, 0.45, 4, 0.25);
    box(2, -6.15, 4.95, z, 0.08, 1.2, 4.2);
    box(1, -6.23, 4.95, z, 0.1, 1.25, 0.06);
    box(1, -7.1, 4.1, z, 2.4, 0.12, 4.5);
  }
  for (const z of [-11, 0, 11]) {
    box(1, 1, 7, z, 2.8, 0.8, 3);
    box(1, 5.2, 3.2, z, 0.15, 6.5, 0.15);
  }
  [concrete, steel, glass].forEach((material, i) => {
    const mesh = new Mesh(mergeGeometries(parts[i])!, material);
    parts[i].forEach((geometry) => geometry.dispose());
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  });
  return root;
}
