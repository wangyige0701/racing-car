export const QUALITY = {
  high: { dpr: 2, shadow: 2048, treeDistance: 180, smoke: 1 },
  balanced: { dpr: 1, shadow: 1024, treeDistance: 100, smoke: 0.65 },
  economy: { dpr: 1, shadow: 0, treeDistance: 50, smoke: 0.35 },
} as const;
export type Quality = keyof typeof QUALITY;
export function defaultQuality(): Quality {
  return typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches
    ? "balanced"
    : "high";
}
