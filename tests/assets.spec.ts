import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("shipped GLB matches its manifest and remains a self-contained licensed asset", async () => {
  const folder = "public/assets/vehicles/car-concept/";
  const bytes = await readFile(`${folder}car.glb`);
  const report = JSON.parse(await readFile(`${folder}asset.json`, "utf8"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.outputSha256);
  expect(bytes.length).toBeLessThan(6_000_000);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(json.asset.copyright).toContain("Eric Chadwick");
  expect(json.buffers.every((buffer: { uri?: string }) => !buffer.uri)).toBe(true);
  expect(json.images.every((image: { uri?: string }) => !image.uri)).toBe(true);
  expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
  expect(await readFile(`${folder}CREDITS.md`, "utf8")).toContain(
    "Creative Commons Attribution 4.0",
  );
});

test("GLB binds left steering, four centred wheels, brake lights and releases all PBR textures", async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  const result = await page.evaluate(async () => {
    const visualPath = "/src/vehicle/VehicleVisual.ts",
      physicsPath = "/src/vehicle/VehiclePhysics.ts",
      worldPath = "/src/physics/PhysicsWorld.ts",
      trackPath = "/src/track/Track.ts",
      disposePath = "/src/rendering/dispose.ts";
    const { VehicleVisual } = await import(visualPath);
    const { VehiclePhysics } = await import(physicsPath);
    const { PhysicsWorld } = await import(worldPath);
    const { Track } = await import(trackPath);
    const { disposeObject } = await import(disposePath);
    const visual = await VehicleVisual.load(new AbortController().signal);
    const track = new Track(),
      world = await PhysicsWorld.create(track),
      vehicle = new VehiclePhysics(world.world, track);
    const root = visual.root;
    const steering = root.getObjectByName("AnimatedSteering");
    visual.update(vehicle, 1);
    const initial = steering.quaternion.clone();
    const neutralTop = root.position.clone().set(0, 1, 0).applyQuaternion(initial);
    vehicle.steer = 0.2;
    vehicle.brake = 1;
    vehicle.wheelAngles.fill(1.2);
    visual.update(vehicle, 1);
    const materials = new Set<any>(),
      textures = new Set<any>();
    root.traverse((object: any) => {
      if (object.isMesh)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material) as any[])
            if (value?.isTexture) textures.add(value);
        }
    });
    let disposed = 0;
    textures.forEach((texture) => texture.addEventListener("dispose", () => disposed++));
    const wheels = [0, 1, 2, 3].map((i) => {
      const pivot = root.getObjectByName(`Suspension_${i}`);
      return {
        position: pivot.position.toArray(),
        steer: pivot.rotation.y,
        spin: pivot.children[0].rotation.x,
      };
    });
    const result = {
      steeringX: steering.position.x,
      steeringChange: initial.angleTo(steering.quaternion),
      // A positive physical yaw steers left: the wheel's top must move to driver left (+X).
      steeringTopDelta:
        root.position.clone().set(0, 1, 0).applyQuaternion(steering.quaternion).x - neutralTop.x,
      wheels,
      brake: [...materials].find((m) => m.name === "Brakelight")?.emissiveIntensity,
      textures: textures.size,
      disposed: 0,
    };
    world.dispose();
    disposeObject(root);
    result.disposed = disposed;
    return result;
  });
  // The camera looks toward +Z: +X projects to its left, matching the source's L nodes.
  expect(result.steeringX).toBeGreaterThan(0.35);
  expect(result.steeringChange).toBeGreaterThan(0.3);
  expect(result.steeringTopDelta).toBeGreaterThan(0);
  expect(result.wheels.map((w) => w.position)).toEqual([
    [-0.94, -0.32, 1.32],
    [0.94, -0.32, 1.32],
    [-0.94, -0.32, -1.32],
    [0.94, -0.32, -1.32],
  ]);
  expect(result.wheels.map((w) => w.steer)).toEqual([0.2, 0.2, 0, 0]);
  expect(result.wheels.every((w) => w.spin === 1.2)).toBe(true);
  expect(result.brake).toBe(4);
  expect(result.textures).toBeGreaterThan(5);
  expect(result.disposed).toBe(result.textures);
});

test("smoke stays bounded, expires and does not emit from airborne rear wheels", async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  const result = await page.evaluate(async () => {
    const smokePath = "/src/rendering/TireSmoke.ts",
      physicsPath = "/src/vehicle/VehiclePhysics.ts",
      worldPath = "/src/physics/PhysicsWorld.ts",
      trackPath = "/src/track/Track.ts",
      cameraPath = "/src/camera/CameraManager.ts",
      disposePath = "/src/rendering/dispose.ts";
    const { TireSmoke } = await import(smokePath);
    const { VehiclePhysics } = await import(physicsPath);
    const { PhysicsWorld } = await import(worldPath);
    const { Track } = await import(trackPath);
    const { CameraManager } = await import(cameraPath);
    const { disposeObject } = await import(disposePath);
    const track = new Track(),
      world = await PhysicsWorld.create(track),
      vehicle = new VehiclePhysics(world.world, track);
    const smoke = new TireSmoke(),
      camera = new CameraManager().camera;
    const controls = { throttle: 0, brake: 0, handbrake: 0, steer: 0 };
    const step = () => {
      vehicle.beforeStep(1 / 60, controls);
      world.step(1 / 60);
      vehicle.afterStep(1 / 60);
    };
    for (let i = 0; i < 120; i++) step();
    vehicle.drift.active = true;
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      smoke.update(vehicle, camera, 1 / 60);
      peak = Math.max(peak, smoke.count);
    }
    vehicle.drift.active = false;
    for (let i = 0; i < 100; i++) smoke.update(vehicle, camera, 1 / 60);
    const expired = smoke.count;
    vehicle.body.setTranslation({ x: vehicle.position.x, y: 20, z: vehicle.position.z }, true);
    step();
    vehicle.drift.active = true;
    const grounded = vehicle.groundedWheels;
    for (let i = 0; i < 120; i++) smoke.update(vehicle, camera, 1 / 60);
    const airborne = smoke.count;
    smoke.clear();
    const cleared = smoke.count;
    disposeObject(smoke.root);
    world.dispose();
    return { peak, expired, airborne, grounded, cleared };
  });
  expect(result.peak).toBeGreaterThan(60);
  expect(result.peak).toBeLessThanOrEqual(96);
  expect(result.expired).toBe(0);
  expect(result.grounded).toBe(0);
  expect(result.airborne).toBe(0);
  expect(result.cleared).toBe(0);
});

test("a failed model download gives a retryable error without replacing it with a box", async ({
  page,
}) => {
  await page.route("**/car.glb", (route) =>
    route.fulfill({ status: 503, body: "temporarily unavailable" }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("GLB 加载失败");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.unroute("**/car.glb");
  await page.getByRole("button", { name: "重新检测" }).click();
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
});

test("partial audio initialization failure closes its context and driving remains available", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const contexts: AudioContext[] = [];
    Reflect.set(window, "__failedAudioContexts", contexts);
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
      createOscillator(): OscillatorNode {
        throw new Error("injected audio initialization failure");
      }
    };
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  await page.keyboard.down("w");
  await expect(page.getByTestId("audio-state")).toHaveText("unavailable");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__failedAudioContexts")[0]?.state))
    .toBe("closed");
  await expect
    .poll(async () => Number(await page.getByTestId("speed").getAttribute("data-speed")))
    .toBeGreaterThan(10);
  await page.keyboard.up("w");
  expect(errors).toEqual([]);
});

test("audio unlocks on a real gesture, follows RPM, mutes and closes on dispose", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const contexts: AudioContext[] = [],
      oscillators: OscillatorNode[] = [],
      gains: GainNode[] = [];
    Reflect.set(window, "__audioProbe", { contexts, oscillators, gains });
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
      createOscillator() {
        const node = super.createOscillator();
        oscillators.push(node);
        return node;
      }
      createGain() {
        const node = super.createGain();
        gains.push(node);
        return node;
      }
    };
  });
  await page.goto("/");
  await expect(page.getByText("自由驾驶中", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__audioProbe").contexts.length)).toBe(0);
  await page.keyboard.down("w");
  await expect(page.getByTestId("audio-state")).toHaveText("running");
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__audioProbe").oscillators[0].frequency.value),
    )
    .toBeGreaterThan(90);
  await page.keyboard.up("w");
  await page.getByRole("button", { name: "切换静音" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__audioProbe").gains[0].gain.value))
    .toBeLessThan(0.005);
  await page.getByRole("button", { name: "切换静音" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__audioProbe").gains[0].gain.value))
    .toBeGreaterThan(0.4);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__audioProbe").gains[0].gain.value))
    .toBeLessThan(0.005);
  // Vue unmount is also the cleanup path for leaving the game.
  await page.evaluate(() => (document.querySelector("#app") as any).__vue_app__.unmount());
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__audioProbe").contexts[0].state))
    .toBe("closed");
});
