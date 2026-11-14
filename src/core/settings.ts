import { DEFAULT_CAMERA_SETTINGS, type CameraMode, type CameraSettings } from "../camera/config";
import { defaultQuality, QUALITY, type Quality } from "../rendering/quality";

const STORAGE_KEY = "drive-drive-car-settings-v1";

export interface GameSettings {
  audioMuted: boolean;
  audioVolume: number;
  quality: Quality;
  steeringSensitivity: number;
  cameraMode: CameraMode;
  cameraSettings: CameraSettings;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function loadGameSettings(): GameSettings {
  const defaults: GameSettings = {
    audioMuted: false,
    audioVolume: 0.35,
    quality: defaultQuality(),
    steeringSensitivity: 1,
    cameraMode: "chase",
    cameraSettings: { ...DEFAULT_CAMERA_SETTINGS },
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<GameSettings>;
    const camera = stored.cameraSettings;
    return {
      audioMuted: typeof stored.audioMuted === "boolean" ? stored.audioMuted : defaults.audioMuted,
      audioVolume: clamp(stored.audioVolume, 0, 1, defaults.audioVolume),
      quality:
        typeof stored.quality === "string" && Object.hasOwn(QUALITY, stored.quality)
          ? (stored.quality as Quality)
          : defaults.quality,
      steeringSensitivity: clamp(
        stored.steeringSensitivity,
        0.6,
        1.4,
        defaults.steeringSensitivity,
      ),
      cameraMode:
        stored.cameraMode === "cockpit" ||
        stored.cameraMode === "hood" ||
        stored.cameraMode === "bumper"
          ? stored.cameraMode
          : "chase",
      cameraSettings: {
        fov: clamp(camera?.fov, 55, 80, defaults.cameraSettings.fov),
        height: clamp(camera?.height, -0.04, 0.08, defaults.cameraSettings.height),
        back: clamp(camera?.back, -0.08, 0.06, defaults.cameraSettings.back),
        motion:
          typeof camera?.motion === "boolean" ? camera.motion : defaults.cameraSettings.motion,
      },
    };
  } catch {
    return defaults;
  }
}

export function saveGameSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 无痕模式或存储配额耗尽均不应阻止驾驶。
  }
}
