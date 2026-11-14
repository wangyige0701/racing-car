<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { initialDiagnostics } from "../core/types";
import { CAMERA_LABELS } from "../camera/config";
import type { GameApplication } from "../core/GameApplication";
import type { TouchControl } from "../input/InputManager";
import { defaultQuality, type Quality } from "../rendering/quality";
import TouchSteering from "./TouchSteering.vue";
import { DEFAULT_CAMERA_SETTINGS } from "../camera/config";
import { TRACKS, type TrackId } from "../track/catalog";

const viewport = ref<HTMLDivElement>();
const drivingPanel = ref<HTMLElement>();
const diagnostics = shallowRef(initialDiagnostics());
const quality = ref<Quality>(defaultQuality());
const cameraSettings = ref({ ...DEFAULT_CAMERA_SETTINGS });
function changeCamera() {
  application?.setCameraSettings(cameraSettings.value);
}
function chooseTrack(event: Event) {
  void application?.selectTrack((event.target as HTMLSelectElement).value as TrackId);
  (event.target as HTMLSelectElement).blur();
}
function lapTime(seconds: number) {
  const hundredths = Math.floor(seconds * 100);
  return hundredths > 0
    ? `${Math.floor(hundredths / 6000)}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, "0")}`
    : "—";
}
function look(value: number, event: PointerEvent) {
  event.preventDefault();
  if (value) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  application?.look(value);
}
let application: GameApplication | undefined;
let unmounted = false;
const fullscreen = ref(false);
const ready = computed(() => ["running", "paused"].includes(diagnostics.value.phase));
const paused = computed(() => diagnostics.value.phase === "paused");
const time = computed(() => {
  const seconds = diagnostics.value.elapsed;
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
});
const status = computed(
  () =>
    ({
      starting: "正在准备赛道",
      running: "自由驾驶中",
      paused: "驾驶已暂停",
      error: "引擎已停止",
    })[diagnostics.value.phase],
);
function fullscreenChanged() {
  fullscreen.value = document.fullscreenElement === drivingPanel.value;
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await drivingPanel.value?.requestFullscreen();
  } catch {
    // Fullscreen is optional and can be rejected by an embedded browser.
  }
}
onMounted(async () => {
  document.addEventListener("fullscreenchange", fullscreenChanged);
  try {
    const { GameApplication } = await import("../core/GameApplication");
    if (unmounted || !viewport.value) return;
    application = new GameApplication(viewport.value, (snapshot) => {
      diagnostics.value = snapshot;
      quality.value = snapshot.quality;
      cameraSettings.value = { ...snapshot.cameraSettings };
    });
    await application.start();
  } catch (error) {
    if (!unmounted)
      diagnostics.value = {
        ...diagnostics.value,
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      };
  }
});
onBeforeUnmount(() => {
  unmounted = true;
  document.removeEventListener("fullscreenchange", fullscreenChanged);
  application?.dispose();
});
function retry() {
  if (application) void application.restart();
  else window.location.reload();
}
function changeQuality(event: Event) {
  application?.setQuality(quality.value);
  (event.target as HTMLElement).blur();
}
function changeAudioVolume(event: Event) {
  application?.setAudioVolume(Number((event.target as HTMLInputElement).value));
}
function touch(control: TouchControl, event: PointerEvent, pressed: boolean) {
  event.preventDefault();
  const button = event.currentTarget as HTMLElement;
  if (pressed) button.setPointerCapture(event.pointerId);
  application?.touch(control, pressed);
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="APEX 赛车首页">
        <span class="brand-mark">A</span>
        APEX
        <span class="brand-divider"></span>
        <span class="brand-sub">RACING LAB</span>
      </a>
      <span class="project-label">CAR CONCEPT <b>/</b> 左舵驾驶体验</span>
      <span class="stage-pill"><i></i> APEX / LHD</span>
    </header>
    <main>
      <section class="track-heading">
        <div>
          <div class="eyebrow"><span></span> APEX / CIRCUITS</div>
          <h1>{{ diagnostics.trackName }} <span>自由练习</span></h1>
          <p>
            {{ diagnostics.trackLength ? (diagnostics.trackLength / 1000).toFixed(2) : "—" }} km
            <b>·</b> 闭合测试赛道 <b>·</b> 晴 / 干燥路面
          </p>
        </div>
        <div class="toolbar">
          <select
            class="track-select"
            aria-label="选择赛道"
            :value="diagnostics.trackId"
            :disabled="!ready"
            @change="chooseTrack"
          >
            <option v-for="track in TRACKS" :key="track.id" :value="track.id">
              {{ track.name }}
            </option>
          </select>
          <button
            class="button secondary audio-button"
            :disabled="!ready"
            @click="application?.toggleAudio()"
            :aria-pressed="diagnostics.audioMuted"
            aria-label="切换静音"
          >
            {{ diagnostics.audioMuted ? "已静音" : "音效开启" }}
          </button>
          <label class="volume-control">
            <span>音量 {{ Math.round(diagnostics.audioVolume * 100) }}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="diagnostics.audioVolume"
              :disabled="!ready"
              aria-label="音量"
              @input="changeAudioVolume"
            />
          </label>
          <label class="quality-control">
            <span>画质</span>
            <select
              v-model="quality"
              aria-label="渲染精度"
              :disabled="!ready"
              @change="changeQuality"
            >
              <option value="high">高 · 2×</option>
              <option value="balanced">均衡 · 1×</option>
              <option value="economy">流畅 · 1×</option>
            </select>
          </label>
          <button class="button secondary" :disabled="!ready" @click="application?.resetVehicle()">
            重置车辆 <kbd>R</kbd>
          </button>
          <button
            class="button secondary camera-button"
            aria-label="切换视角"
            :disabled="!ready"
            @click="application?.cycleCamera()"
          >
            {{ CAMERA_LABELS[diagnostics.cameraMode] }} <kbd>C</kbd>
          </button>
          <button
            class="button secondary fullscreen-button"
            :disabled="!ready"
            :aria-label="fullscreen ? '退出全屏' : '进入全屏'"
            @click="toggleFullscreen"
          >
            {{ fullscreen ? "退出全屏" : "全屏" }}
          </button>
          <button class="button primary" :disabled="!ready" @click="application?.togglePause()">
            {{ paused ? "继续驾驶" : "暂停驾驶" }} <kbd>ESC</kbd>
          </button>
        </div>
      </section>

      <section
        ref="drivingPanel"
        class="driving-panel"
        :class="{ 'onboard-view': diagnostics.cameraMode !== 'chase' }"
        aria-label="赛车自由练习"
      >
        <div ref="viewport" class="viewport" data-testid="viewport"></div>
        <div class="mobile-actions">
          <button :disabled="!ready" @click="application?.cycleCamera()" aria-label="横屏切换视角">
            视角
          </button>
          <button :disabled="!ready" @click="application?.togglePause()" aria-label="横屏暂停菜单">
            {{ paused ? "继续" : "暂停 / 设置" }}
          </button>
          <button
            :disabled="!ready"
            @click="toggleFullscreen"
            :aria-label="fullscreen ? '退出全屏' : '进入全屏'"
          >
            {{ fullscreen ? "退出" : "全屏" }}
          </button>
        </div>
        <div class="scene-vignette"></div>
        <div v-if="fullscreen && ready" class="fullscreen-telemetry" aria-label="全屏引擎信息">
          <span>{{ diagnostics.backend }}</span>
          <b>{{ diagnostics.fps || "—" }} FPS</b>
          <span>PHYS {{ diagnostics.physicsMs.toFixed(2) }} MS</span>
          <span>接触 {{ diagnostics.collisions }}</span>
        </div>
        <div v-if="ready && !paused && diagnostics.cameraMode === 'cockpit'" class="look-controls">
          <button
            aria-label="向左观察"
            @pointerdown="look(1, $event)"
            @pointerup="look(0, $event)"
            @pointercancel="look(0, $event)"
            @lostpointercapture="look(0, $event)"
          >
            ← 看左
          </button>
          <button
            aria-label="向右观察"
            @pointerdown="look(-1, $event)"
            @pointerup="look(0, $event)"
            @pointercancel="look(0, $event)"
            @lostpointercapture="look(0, $event)"
          >
            看右 →
          </button>
        </div>
        <div class="scene-topline">
          <div class="session-title">
            <span class="live-dot" :class="{ inactive: diagnostics.phase !== 'running' }"></span>
            <span>{{ status }}</span>
            <b>/</b>
            <span class="session-number">SESSION 01</span>
          </div>
          <span class="prototype-label">CAR CONCEPT · 左舵</span>
        </div>

        <template v-if="ready">
          <div class="lap-hud" data-testid="lap-hud">
            <strong>{{
              diagnostics.wrongWay
                ? "逆向行驶"
                : !diagnostics.lapValid
                  ? "本圈无效"
                  : diagnostics.lapStarted
                    ? lapTime(diagnostics.lapTime)
                    : "通过起点开始计圈"
            }}</strong>
            <span>
              完成 {{ diagnostics.laps }} 圈 · 下一点
              {{ diagnostics.nextCheckpoint ? `CP ${diagnostics.nextCheckpoint}` : "起点" }}
            </span>
            <small>
              上圈 {{ lapTime(diagnostics.lastLap) }} · 最佳
              {{ lapTime(diagnostics.bestLap) }}
            </small>
          </div>
          <div class="session-info">
            <span class="hud-label">PRACTICE TIME</span>
            <strong data-testid="elapsed">{{ time }}</strong>
            <div>
              <span>练习里程</span>
              <b data-testid="distance">
                {{ (diagnostics.distance / 1000).toFixed(2) }} <small>km</small>
              </b>
            </div>
          </div>
          <div class="track-map">
            <div class="map-heading"><span>赛道位置</span><span>N ↑</span></div>
            <svg :viewBox="diagnostics.mapViewBox" role="img" aria-label="赛道地图与车辆位置">
              <polygon
                :points="diagnostics.mapPoints"
                fill="none"
                stroke="#d5ddc5"
                stroke-opacity=".18"
                stroke-width="22"
                stroke-linejoin="round"
              />
              <polygon
                :points="diagnostics.mapPoints"
                fill="none"
                stroke="#d5ddc5"
                stroke-opacity=".8"
                stroke-width="3"
                stroke-linejoin="round"
              />
              <g
                :transform="`translate(${diagnostics.mapX},${diagnostics.mapY}) scale(${Math.max(1, diagnostics.trackLength / 950)}) rotate(${diagnostics.heading})`"
                :data-heading="diagnostics.heading"
                :data-position="`${diagnostics.mapX.toFixed(2)},${diagnostics.mapY.toFixed(2)}`"
                data-testid="map-marker"
              >
                <circle r="16" fill="#d9f582" fill-opacity=".2" />
                <path
                  d="M 0 -12 L 8 9 L 0 5 L -8 9 Z"
                  fill="#d9f582"
                  stroke="#26342b"
                  stroke-width="2"
                />
              </g>
            </svg>
            <span class="map-caption">
              {{ diagnostics.trackName }}
              <b>{{ (diagnostics.trackLength / 1000).toFixed(2) }} KM</b>
            </span>
          </div>

          <div class="speedometer">
            <div class="vehicle-name">APEX <span>/ CAR CONCEPT</span></div>
            <div class="speed-row">
              <div class="gear">
                <span>GEAR</span>
                <strong data-testid="gear">{{
                  diagnostics.gear === -1 ? "R" : diagnostics.gear
                }}</strong>
              </div>
              <div class="speed-value">
                <strong data-testid="speed" :data-speed="diagnostics.speedKmh.toFixed(2)">{{
                  Math.round(Math.abs(diagnostics.speedKmh)).toString().padStart(3, "0")
                }}</strong>
                <span>KM/H</span>
              </div>
            </div>
            <div class="rpm-scale"><span>1</span><span>3</span><span>5</span><span>7</span></div>
            <div class="rpm-bar">
              <i :style="{ transform: `scaleX(${diagnostics.rpm / 7500})` }"></i>
            </div>
            <div class="rpm-caption">
              <span>{{ Math.round(diagnostics.rpm) }} <small>RPM</small></span>
              <span>AUTO <b>●</b></span>
            </div>
            <div class="pedals">
              <span>油门</span>
              <div>
                <i
                  :style="{ transform: `scaleX(${diagnostics.throttle})` }"
                  data-testid="throttle"
                  :data-value="diagnostics.throttle"
                ></i>
              </div>
              <span>制动</span>
              <div class="brake-bar">
                <i :style="{ transform: `scaleX(${diagnostics.brake})` }"></i>
              </div>
            </div>
          </div>

          <div
            v-if="diagnostics.distance < 8 && !paused && diagnostics.cameraMode === 'chase'"
            class="drive-hint"
          >
            <kbd>W</kbd><span>轻踩油门，开始你的第一圈。</span>
          </div>
          <div v-if="diagnostics.collisionRecent && !paused" class="collision-note">
            {{ diagnostics.impactStrength > 0.35 ? "撞击护栏" : "轻微接触" }} · 调整方向继续行驶
          </div>
          <div
            class="dynamics-hud"
            :class="{ sliding: diagnostics.drifting }"
            data-testid="drift-state"
            :data-active="diagnostics.drifting"
          >
            <span data-testid="handbrake" :data-value="diagnostics.handbrake">{{
              diagnostics.driftRecovering
                ? "收车辅助 · 恢复抓地"
                : diagnostics.burnout
                  ? `烧胎蓄力 ${Math.round(diagnostics.launchCharge * 100)}%`
                  : diagnostics.handbrake > 0.1
                    ? "手刹制动"
                    : diagnostics.drifting
                      ? "漂移中"
                      : diagnostics.rearGrip < 0.92
                        ? "抓地恢复"
                        : "稳定行驶"
            }}</span>
            <strong>{{ Math.abs(diagnostics.slipAngle).toFixed(0) }}<small>°</small></strong>
            <span>累计漂移 {{ diagnostics.driftTime.toFixed(1) }} s</span>
          </div>
        </template>

        <div v-if="diagnostics.phase === 'starting'" class="scene-message" role="status">
          <span class="loader"></span>
          <span class="eyebrow">GETTING ON TRACK</span>
          <h2>赛道正在就绪</h2>
          <p>{{ diagnostics.message }}</p>
        </div>
        <div
          v-else-if="diagnostics.phase === 'error'"
          class="scene-message error-message"
          role="alert"
        >
          <span class="error-icon">!</span>
          <h2>引擎未能继续运行</h2>
          <p>{{ diagnostics.message }}</p>
          <small
            >请使用支持 WebGPU 的现代浏览器，开启硬件加速，并通过 localhost 或 HTTPS 访问。</small
          >
          <button class="button primary" @click="retry">重新检测 <span>↗</span></button>
        </div>
        <div v-else-if="paused" class="pause-overlay">
          <div class="pause-card">
            <span class="eyebrow">TAKE A BREATHER</span>
            <h2>暂停一下，再出发。</h2>
            <p>失去焦点时会自动暂停。恢复后请重新操作油门。</p>
            <details class="camera-settings">
              <summary>驾驶舱设置</summary>
              <label>
                视野 {{ cameraSettings.fov }}°
                <input
                  type="range"
                  min="55"
                  max="80"
                  step="1"
                  v-model.number="cameraSettings.fov"
                  @input="changeCamera"
                  aria-label="驾驶舱视野"
                />
              </label>
              <label>
                座椅高度
                <input
                  type="range"
                  min="-0.04"
                  max="0.08"
                  step="0.01"
                  v-model.number="cameraSettings.height"
                  @input="changeCamera"
                />
              </label>
              <label>
                座椅后移
                <input
                  type="range"
                  min="-0.08"
                  max="0.06"
                  step="0.01"
                  v-model.number="cameraSettings.back"
                  @input="changeCamera"
                />
              </label>
              <label>
                <input type="checkbox" v-model="cameraSettings.motion" @change="changeCamera" />
                轻微惯性、看弯与撞击镜头
              </label>
            </details>
            <div class="mobile-settings">
              <select
                aria-label="横屏选择赛道"
                :value="diagnostics.trackId"
                :disabled="!ready"
                @change="chooseTrack"
              >
                <option v-for="track in TRACKS" :key="track.id" :value="track.id">
                  {{ track.name }}
                </option>
              </select>
              <button @click="application?.resetVehicle()">重置车辆</button>
              <button @click="application?.toggleAudio()">
                {{ diagnostics.audioMuted ? "开启音效" : "静音" }}
              </button>
              <label class="volume-control">
                音量 {{ Math.round(diagnostics.audioVolume * 100) }}%
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="diagnostics.audioVolume"
                  aria-label="音量"
                  @input="changeAudioVolume"
                />
              </label>
              <select v-model="quality" aria-label="横屏画质" @change="changeQuality">
                <option value="high">高画质</option>
                <option value="balanced">均衡画质</option>
                <option value="economy">流畅画质</option>
              </select>
            </div>
            <button class="button primary" @click="application?.togglePause()">
              回到驾驶 <span>↗</span>
            </button>
            <small>或按 ESC / 手柄 Start</small>
          </div>
        </div>
        <div class="scene-bottomline">
          <span>
            <span data-testid="camera-mode">{{ CAMERA_LABELS[diagnostics.cameraMode] }}</span>
            <b>·</b>
            {{ diagnostics.inputSource }}
          </span>
          <span>
            {{ diagnostics.width }} × {{ diagnostics.height }} <b>/</b> DPR
            {{ diagnostics.pixelRatio.toFixed(1) }}
          </span>
        </div>
      </section>

      <div class="touch-controls" aria-label="触控驾驶">
        <TouchSteering :enabled="ready && !paused" @change="application?.touchSteering($event)" />
        <button
          v-for="control in ['left', 'right', 'brake', 'handbrake', 'throttle'] as const"
          :key="control"
          :aria-label="
            {
              left: '向左转向',
              right: '向右转向',
              brake: '制动和倒车',
              handbrake: '手刹漂移',
              throttle: '加速',
            }[control]
          "
          :disabled="!ready || paused"
          :class="[control, { accelerator: control === 'throttle' }]"
          @pointerdown="touch(control, $event, true)"
          @pointerup="touch(control, $event, false)"
          @pointercancel="touch(control, $event, false)"
          @lostpointercapture="touch(control, $event, false)"
        >
          {{
            {
              left: "←",
              right: "→",
              brake: "制动",
              handbrake: diagnostics.drifting ? "手刹收车" : "手刹",
              throttle: "加速 ↑",
            }[control]
          }}
        </button>
      </div>

      <section class="driving-guide" aria-label="驾驶操作">
        <div><kbd>W</kbd><kbd>↑</kbd><span>加速</span></div>
        <div><kbd>S</kbd><kbd>↓</kbd><span>制动 / 停稳后倒车</span></div>
        <div><kbd>W</kbd><kbd>S</kbd><span>静止烧胎 · 松开制动弹射</span></div>
        <div><kbd>A</kbd><kbd>D</kbd><span>平滑转向</span></div>
        <div><kbd>Space</kbd><span>短按起漂 · 再按收车</span></div>
        <span class="gamepad-guide">手柄：RT / LT 踏板 · A 手刹 · X 视角</span>
        <span class="engine-status">
          <i></i>
          <span data-testid="backend">{{ diagnostics.backend }}</span>
          <b>{{ diagnostics.fps || "—" }} FPS</b>
        </span>
      </section>
      <details class="diagnostics">
        <summary>引擎诊断 <span>RAPIER / FIXED 60 HZ</span></summary>
        <div class="diagnostics-grid">
          <div>渲染帧数 <b data-testid="frames">{{ diagnostics.frames }}</b></div>
          <div>物理步数 <b data-testid="physics-steps">{{ diagnostics.physicsSteps }}</b></div>
          <div>车轮着地 <b data-testid="grounded">{{ diagnostics.groundedWheels }} / 4</b></div>
          <div>
            前轮转向
            <b data-testid="steering" :data-value="diagnostics.steer">{{
              diagnostics.steer.toFixed(2)
            }}</b>
          </div>
          <div>护栏接触 <b data-testid="collisions">{{ diagnostics.collisions }}</b></div>
          <div>轮胎烟雾 <b data-testid="smoke-count">{{ diagnostics.smokeParticles }}</b></div>
          <div>音频状态 <b data-testid="audio-state">{{ diagnostics.audioStatus }}</b></div>
          <div>侧滑角 <b data-testid="slip-angle">{{ diagnostics.slipAngle.toFixed(1) }}°</b></div>
          <div>
            后轮抓地
            <b data-testid="rear-grip" :data-value="diagnostics.rearGrip">
              {{ (diagnostics.rearGrip * 100).toFixed(0) }}%
            </b>
          </div>
          <div>物理 CPU / 步 <b>{{ diagnostics.physicsMs.toFixed(2) }} ms</b></div>
          <div>渲染 CPU 提交 / 帧 <b>{{ diagnostics.renderSubmitMs.toFixed(2) }} ms</b></div>
        </div>
        <p>{{ diagnostics.adapter }} · GPU 执行时间未采样；当前为车辆原型，非完整游戏性能验收。</p>
      </details>
    </main>
    <footer>
      <span>APEX <b>/</b> BUILT FOR THE NEXT CORNER.</span>
      <span>
        Car Concept · Eric Chadwick / DGG ·
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener"
          >CC BY 4.0</a
        >
        ·
        <a href="./assets/vehicles/car-concept/CREDITS.md" target="_blank" rel="noopener"
          >模型署名与改动</a
        >
      </span>
    </footer>
  </div>
</template>
