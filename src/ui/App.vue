<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { initialDiagnostics } from "../core/types";
import type { GameApplication } from "../core/GameApplication";

const viewport = ref<HTMLDivElement>();
const diagnostics = shallowRef(initialDiagnostics());
const quality = ref<"high" | "balanced">("high");
const fpsHistory = ref<number[]>(Array(14).fill(0));
let application: GameApplication | undefined;
let unmounted = false;
const ready = computed(() => ["running", "paused"].includes(diagnostics.value.phase));
const paused = computed(() => diagnostics.value.phase === "paused");
const statusText = computed(
  () =>
    ({ starting: "系统初始化", running: "实时运行中", paused: "模拟已暂停", error: "启动未完成" })[
      diagnostics.value.phase
    ],
);

onMounted(async () => {
  try {
    const { GameApplication } = await import("../core/GameApplication");
    if (unmounted || !viewport.value) return;
    application = new GameApplication(viewport.value, (snapshot) => {
      if (snapshot.frames !== diagnostics.value.frames) {
        fpsHistory.value = [...fpsHistory.value.slice(1), snapshot.fps];
      }
      diagnostics.value = snapshot;
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
  application?.dispose();
});
function changeQuality() {
  application?.setQuality(quality.value);
}
function retry() {
  if (application) void application.restart();
  else window.location.reload();
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="APEX Racing Lab 首页"
        ><span class="brand-mark">A</span>APEX<span class="brand-divider"></span
        ><span class="brand-sub">RACING LAB</span></a
      >
      <div class="project-label">赛车研发计划 <span>/</span> 技术验证</div>
      <div class="stage-pill"><span></span> PHASE 01 / 07</div>
    </header>

    <main>
      <section class="intro">
        <div>
          <div class="eyebrow"><span class="tiny-line"></span> THE FOUNDATION OF SPEED</div>
          <h1>速度，始于每一帧<span>。</span></h1>
          <p>WebGPU 渲染与刚体物理验证。为下一段赛程，打好基础。</p>
        </div>
        <div class="intro-index">
          <span>01</span>
          <div>ENGINE<br />VALIDATION</div>
        </div>
      </section>

      <div class="workspace">
        <section class="scene-panel" aria-label="三维物理验证场景">
          <div ref="viewport" class="viewport" data-testid="viewport"></div>
          <div class="scene-topline">
            <div class="live-badge" :class="{ inactive: diagnostics.phase !== 'running' }">
              <i></i>{{ statusText }}
            </div>
            <span class="scene-tag">TEST PAD — A01</span>
          </div>

          <div v-if="diagnostics.phase === 'starting'" class="scene-message" role="status">
            <div class="loader"></div>
            <h2>正在唤醒引擎</h2>
            <p>{{ diagnostics.message }}</p>
          </div>
          <div
            v-else-if="diagnostics.phase === 'error'"
            class="scene-message error-message"
            role="alert"
          >
            <span class="error-icon">!</span>
            <h2>无法启动 WebGPU</h2>
            <p>{{ diagnostics.message }}</p>
            <span class="error-help"
              >请使用支持 WebGPU 的现代浏览器，启用硬件加速，并通过 localhost 或 HTTPS 访问。</span
            ><button class="button primary" @click="retry">重新检测 <span>↗</span></button>
          </div>

          <template v-if="ready">
            <div class="scene-side-label">RIGID BODY / GRAVITY TEST</div>
            <div class="scene-caption">
              <span class="crosshair">＋</span>
              <div>
                <strong>物理校准台</strong>
                <p>动态球体 · 重力 · 地面碰撞</p>
              </div>
            </div>
            <div class="scene-scale">
              <span>Y {{ diagnostics.bodyHeight.toFixed(2) }} m</span>
              <div></div>
              <small>1 UNIT = 1 METER</small>
            </div>
          </template>
          <div class="scene-bottomline">
            <span>程序化验证场景 · 非正式游戏资产</span
            ><span
              >{{ diagnostics.width }} × {{ diagnostics.height }} <b> / </b> DPR
              {{ diagnostics.pixelRatio.toFixed(1) }}</span
            >
          </div>
        </section>

        <aside class="control-panel">
          <div class="panel-heading">
            <span class="eyebrow">SYSTEM CHECK</span><span class="outline-icon">↗</span>
          </div>
          <h2>引擎检查台</h2>
          <p class="panel-description">真实设备，实时状态。</p>
          <div class="checks">
            <div class="check-row">
              <span class="check-number">01</span>
              <div><strong>图形后端</strong><small>Three.js · TSL</small></div>
              <span
                class="check-value"
                :class="{ verified: diagnostics.backend === 'WebGPU' }"
                data-testid="backend"
                >{{ diagnostics.backend }}</span
              >
            </div>
            <div class="check-row">
              <span class="check-number">02</span>
              <div><strong>物理引擎</strong><small>Rapier 3D · WASM</small></div>
              <span class="check-value" :class="{ verified: diagnostics.physicsReady }">{{
                diagnostics.physicsReady ? "已就绪" : "待初始化"
              }}</span>
            </div>
            <div class="check-row">
              <span class="check-number">03</span>
              <div><strong>模拟步长</strong><small>独立于渲染帧率</small></div>
              <span class="check-value neutral">1 / 60 s</span>
            </div>
          </div>
          <div class="telemetry">
            <div>
              <span class="metric-label">实时帧率</span>
              <p>
                <strong data-testid="fps">{{ diagnostics.fps || "—" }}</strong><small>FPS</small>
              </p>
            </div>
            <div class="telemetry-bars" aria-hidden="true">
              <i
                v-for="(fps, i) in fpsHistory"
                :key="i"
                :style="{
                  height: `${Math.max(3, Math.min(52, fps * 0.65))}px`,
                  opacity: fps ? 0.35 + i / 22 : 0.15,
                }"
              ></i>
            </div>
          </div>
          <dl class="metrics">
            <div>
              <dt>渲染帧数</dt>
              <dd data-testid="frames">{{ diagnostics.frames.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>物理步数</dt>
              <dd data-testid="physics-steps">{{ diagnostics.physicsSteps.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>物理 CPU / 步</dt>
              <dd>{{ diagnostics.physicsMs.toFixed(2) }} ms</dd>
            </div>
            <div>
              <dt>渲染 CPU 提交 / 帧</dt>
              <dd>{{ diagnostics.renderSubmitMs.toFixed(2) }} ms</dd>
            </div>
            <div>
              <dt>初始化耗时</dt>
              <dd>
                {{ diagnostics.loadMs ? `${(diagnostics.loadMs / 1000).toFixed(2)} s` : "—" }}
              </dd>
            </div>
          </dl>
          <div class="quality-row">
            <label for="quality">渲染精度</label
            ><select id="quality" v-model="quality" :disabled="!ready" @change="changeQuality">
              <option value="high">高 · 最高 2×</option>
              <option value="balanced">均衡 · 1×</option>
            </select>
          </div>
          <button class="button primary" :disabled="!ready" @click="application?.resetBody()">
            重新投放刚体 <span>↗</span>
          </button>
          <button class="button secondary" :disabled="!ready" @click="application?.togglePause()">
            {{ paused ? "▷ 继续模拟" : "Ⅱ 暂停模拟" }}
          </button>
          <p class="device-info">
            {{ diagnostics.adapter }}<span>GPU 执行耗时未采样；帧率不代表硬件性能验收。</span>
          </p>
        </aside>
      </div>

      <section class="milestones" aria-label="开发阶段">
        <div class="milestone current">
          <span class="milestone-num">01</span>
          <div>
            <span class="milestone-label">当前阶段</span>
            <h3>基础工程与技术验证</h3>
            <p>WebGPU / 物理 / 渲染循环</p>
          </div>
          <span class="milestone-symbol">●</span>
        </div>
        <div class="milestone">
          <span class="milestone-num">02</span>
          <div>
            <span class="milestone-label">下一阶段 · 未实现</span>
            <h3>可驾驶车辆原型</h3>
            <p>动力 / 转向 / 封闭赛道</p>
          </div>
          <span class="milestone-symbol">↗</span>
        </div>
        <div class="milestone">
          <span class="milestone-num">03–07</span>
          <div>
            <span class="milestone-label">后续阶段 · 未实现</span>
            <h3>从驾驶手感到完整赛程</h3>
            <p>漂移 / 赛道 / 视听 / 游戏体验</p>
          </div>
        </div>
      </section>
    </main>
    <footer>
      <span>APEX <b>/</b> BUILT FOR THE NEXT CORNER.</span
      ><span>原生 WebGPU <i>·</i> 无 WebGL 回退 <i>·</i> DEVELOPMENT BUILD 0.1</span>
    </footer>
  </div>
</template>
