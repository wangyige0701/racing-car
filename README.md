# APEX / Racing Lab

高品质 WebGPU 赛车项目的**第一阶段：基础工程与技术验证**。当前是可独立运行的物理校准台，不是完整赛车游戏。球体、平台与周围设施均为程序化验证资产，不包含正式车辆模型。

## 运行

需要 Node.js 20.19+（22.x 需 22.12+）、pnpm 11.18.0，以及支持 WebGPU 且开启硬件加速的现代浏览器。开发使用 localhost / 127.0.0.1，部署使用 HTTPS。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

打开终端给出的本地地址，默认 `http://127.0.0.1:5173`。

```sh
pnpm build          # Vue / TypeScript 类型检查 + 生产构建
pnpm preview        # 本地预览 dist，默认端口 4173
pnpm test           # 固定步长、Rapier、真实浏览器与异常路径测试
pnpm format:check   # 格式检查
```

测试默认使用已安装的 Google Chrome，不会安装或修改用户浏览器。使用 Edge 时设置 `BROWSER_CHANNEL=msedge`。真实 WebGPU 测试不会跳过不支持 GPU 的环境，也不使用模拟 GPU、WebGL 或软件渲染启动参数来伪造成功。Playwright 会启动测试服务或复用 5173 端口的现有开发服务。

Windows PowerShell 示例：

```powershell
$env:BROWSER_CHANNEL = 'msedge'
pnpm test
```

依赖以精确版本及 `pnpm-lock.yaml` 固定；pnpm 缓存和 store 放在工作区的 `.pnpm-cache/`、`.pnpm-store/`，均不纳入源码。`pnpm-workspace.yaml` 是包管理器配置，不是游戏运行配置。

## 当前可验收行为

- 显式检查安全上下文、`navigator.gpu`，依次申请 GPUAdapter 和 GPUDevice。
- 等待 WebGPURenderer 初始化，并确认实际 `isWebGPUBackend` 及设备身份匹配。
- 强制禁止 Three.js 内建的 WebGL 回退；失败原因在界面显示，可重新检测。
- 使用 TSL 节点材质、PBR 光照、阴影、色调映射及设备支持的抗锯齿持续渲染。
- Rapier 动态球体受重力影响，落在固定平台上、反弹并静止；没有按帧直接修改物理位置。
- 支持重新投放、暂停 / 继续、两档渲染精度。暂停只停止物理，界面与画面仍刷新。
- ResizeObserver 同步视口和相机，DPR 上限分别为 2 和 1；页面隐藏时暂停循环，恢复时不补算隐藏期间的时间。
- 设备丢失或 GPU 未捕获错误会停止运行、释放当前资源并允许重新启动。
- UI 显示实际帧数、物理步数、帧率历史、视口尺寸、设备标识与 CPU 耗时。

物理 CPU 指标为最近一次固定步的耗时，渲染 CPU 指标为最近一次提交耗时，**均不是 GPU 执行时间**。初始化耗时从应用开始请求设备计至首帧提交，不包含 JS 模块下载。帧率是短窗口采样，不构成完整游戏的 60 FPS 承诺。

## 架构

| 路径                               | 职责                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/main.ts`、`src/ui/`           | Vue 入口、响应式验证界面、样式                                              |
| `src/core/GameApplication.ts`      | 启动与销毁、RAF、暂停、缩放、错误处理；向 Vue 最多每秒推送 4 次常规运行快照 |
| `src/core/FixedStep.ts`            | 1/60 秒 accumulator；单帧最多补算 5 步，返回插值系数                        |
| `src/core/types.ts`                | UI 诊断快照契约                                                             |
| `src/rendering/Renderer.ts`        | 申请和验证 GPU 设备、禁止回退、拥有并释放渲染器和设备                       |
| `src/rendering/ValidationScene.ts` | 验证场景、TSL 材质、相机与场景资源释放                                      |
| `src/physics/PhysicsWorld.ts`      | Rapier WASM 初始化、平台碰撞体、动态球体、前后物理状态与重置                |
| `tests/`                           | 固定步长测试、物理碰撞测试与 Playwright 浏览器验收                          |

依赖方向：Vue → GameApplication → Rendering / Physics。物理位置由 Rapier 更新，渲染使用前后物理状态插值。显式“重新投放”是唯一直接重置刚体位置的操作。当前只需要球体高度插值；车辆阶段再扩展位置和四元数姿态。

应用模块按需加载，界面可先于引擎显示。销毁流程取消 RAF、断开 ResizeObserver、移除事件监听，释放 Rapier 世界、几何体、材质、阴影资源、渲染器和自建 GPUDevice。无需外部图片、字体或模型 CDN。

## 依赖与 API 边界

已查询稳定版本并锁定 Vue 3.5.45、Vite 8.3.8、Three.js / 类型声明 0.187.0、Rapier 0.21.0。TypeScript 当前稳定主版本为 7，但 Vue 类型检查器 3.3.14 仍使用传统编译器入口，因此选用稳定的 **TypeScript 6.0.3**，避免使用不兼容的编译器 API。

Three r187 的 WebGPURenderer 构造函数会覆盖传入的 `getFallback`。`StrictWebGPURenderer` 检查并固定实例上的 `_getFallback = null`，在接口发生变化时直接报错。此处是唯一刻意使用的 Three 内部接口，升级依赖时必须重新核对并运行故障注入测试。后端身份和设备对象还会在初始化后再次校验。

已核对 Rapier 0.21.0 的 `World.createVehicleController`、`DynamicRayCastVehicleController.addWheel`、`updateVehicle` 以及悬挂、发动机力、制动与侧向摩擦相关 API。下一阶段优先基于官方射线车辆控制器开发，目前尚未实现车辆或验证驾驶手感。

API 核对依据为安装版本的官方源码、随包 README 和 TypeScript 声明；后续开发可参阅 [Three WebGPURenderer 文档](https://threejs.org/docs/pages/WebGPURenderer.html)、[TSL 文档](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)、[Rapier JavaScript 指南](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) 与 [Vite 指南](https://vite.dev/guide/)。

## 验证与限制

自动化检查覆盖：不同渲染频率下固定物理步数一致；长帧追赶上限；实际重力、反弹、落地与重置；缺少 GPU、适配器 / 设备申请失败、后端初始化失败均不触发 WebGL；真实 WebGPU 渲染；暂停 / 重置；DPR 和窄屏适配；设备丢失与 GPU 错误后的释放及重启。

当前验收环境为 Windows 上的 Chrome、NVIDIA Pascal WebGPU 适配器，未启用强制 GPU 或忽略显卡黑名单的浏览器参数。实际渲染路径检查控制台错误，并生成桌面和窄屏截图到忽略的 `test-results/`。其他显卡、浏览器和长时间内存稳定性仍需验证。

Rapier compat 内嵌 WASM，当前引擎 JS 分块约 5.16 MB（gzip 约 1.89 MB），构建会提示较大分块。尚未进行引擎拆包、独立 WASM 托管、GPU 时间戳分析或完整游戏性能优化。生产部署应对静态文件启用 gzip / Brotli。

## 下一阶段：车辆原型（未实现）

创建一辆可驾驶原型和一条简单闭合赛道，基于 Rapier 射线悬挂实现油门、制动、近零速倒车、平滑转向与碰撞，再加入追尾相机和基础 HUD。验收重点为实际驾驶手感，暂不扩展三条正式赛道或完整比赛流程。

后续正式车辆使用具有授权的 GLB，约定米制尺度、独立前后车轮、车身、玻璃、灯组、刹车盘、驾驶舱和方向盘节点。导入时通过集中资源描述映射节点，保持物理与视觉模型解耦；当前程序化校准资产不作为正式赛车交付。漂移、四视角、三条主题赛道、音频、菜单与结算均属于后续未实现阶段。
