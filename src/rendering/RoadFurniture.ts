import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshStandardNodeMaterial,
  Object3D,
  BoxGeometry,
  DoubleSide,
} from "three/webgpu";
import type { Track } from "../track/Track";

/** 碰撞包络内的波纹钢梁、支撑柱和反光板。 */
export function guardrails(track: Track): Group {
  const profile = [
    [0.02, -0.16],
    [-0.08, -0.1],
    [0.08, -0.05],
    [0.1, 0],
    [0.08, 0.05],
    [-0.08, 0.1],
    [0.02, 0.16],
  ];
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [x, y] of profile) vertices.push(x, y, -0.5, x, y, 0.5);
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const segments = track.barrierSegments();
  const metal = new MeshStandardNodeMaterial({
    color: "#a5adb0",
    roughness: 0.42,
    metalness: 0.8,
    side: DoubleSide,
  });
  const beams = new InstancedMesh(geometry, metal, segments.length * 2);
  const posts = new InstancedMesh(new BoxGeometry(0.1, 1.3, 0.13), metal, segments.length);
  const reflectors = new InstancedMesh(
    new BoxGeometry(0.07, 0.08, 0.11),
    new MeshStandardNodeMaterial({
      color: "#e5b85b",
      roughness: 0.45,
      emissive: "#806531",
      emissiveIntensity: 0.15,
    }),
    segments.length,
  );
  const dummy = new Object3D();
  segments.forEach((segment, i) => {
    dummy.quaternion.copy(segment.rotation);
    for (let level = 0; level < 2; level++) {
      dummy.position.set(segment.x, segment.y + 0.52 + level * 0.46, segment.z);
      dummy.scale.set(1, 1, segment.length);
      dummy.updateMatrix();
      beams.setMatrixAt(i * 2 + level, dummy.matrix);
    }
    dummy.scale.set(1, 1, 1);
    dummy.position.set(segment.x, segment.y + 0.63, segment.z);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
    dummy.position.y = segment.y + 1.18;
    dummy.updateMatrix();
    reflectors.setMatrixAt(i, dummy.matrix);
  });
  beams.castShadow = beams.receiveShadow = posts.castShadow = true;
  const root = new Group();
  root.add(beams, posts, reflectors);
  return root;
}
