// Launches the production build of Stratus under Electron, drives it through a
// set of scenarios, and samples app.getAppMetrics() once a second through the
// hook in electron/measure.cjs. Run `npm run build` first. See docs/performance.md.
//
//   node scripts/measure.mjs [--label before] [--only a,b,c] [--seconds 25] [--runs 1] [--out file.json]
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]);
    return pairs;
  }, []),
);
const label = args.label ?? "run";
const seconds = Number(args.seconds ?? 25);
const runs = Number(args.runs ?? 1);
const settle = Number(args.settle ?? 5);
const outFile = args.out ?? path.join(os.tmpdir(), `stratus-measure-${label}.json`);
const rawFile = outFile.replace(/\.json$/, ".jsonl");
fs.rmSync(rawFile, { force: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One Electron instance with a fresh profile, driven over stdin/stdout. */
const children = new Set();
process.on("exit", () => children.forEach((c) => c.kill()));

async function launch({ offscreen }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-profile-"));
  const child = spawn(electron, ["."], {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      STRATUS_MEASURE: "1",
      STRATUS_MEASURE_OUT: rawFile,
      STRATUS_MEASURE_PROFILE: profile,
      STRATUS_MEASURE_OFFSCREEN: offscreen ? "1" : "",
      VITE_DEV_SERVER_URL: "",
      // Every run has a fresh profile, so the Widevine CDM is never installed
      // yet. Don't let its download (seconds, network-bound) into startup times.
      STRATUS_CDM_WAIT_MS: "1",
    },
  });
  children.add(child);
  const started = performance.now();
  let nextId = 1;
  const pending = new Map();
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("@@measure ")) continue;
      const msg = JSON.parse(line.slice(10));
      if (msg.event === "ready-to-show") readyResolve({ mainMs: msg.ms, wallMs: performance.now() - started });
      else if (pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      }
    }
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  void exited.then((code) => {
    children.delete(child);
    for (const { reject } of pending.values()) reject(new Error(`Electron exited (${code})`));
    pending.clear();
  });

  const call = (message) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
    });
  const app = {
    ready,
    exec: (js) => call({ cmd: "exec", js }),
    metrics: (tag) => call({ cmd: "metrics", label: tag }),
    capture: (file) => call({ cmd: "capture", path: file }),
    async waitFor(js, timeout = 15000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await app.exec(js).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${js}`);
    },
    async quit() {
      await call({ cmd: "quit" }).catch(() => {});
      await Promise.race([exited, sleep(3000)]);
      child.kill();
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  return app;
}

// Installed in the renderer once per launch. Reaches the Pinia stores and the
// router through the mounted Vue app, and remembers the <audio> element the
// player uses by wrapping HTMLMediaElement.play.
const HELPER = `(() => {
  if (window.__m) return true;
  const app = document.querySelector("#app")?.__vue_app__;
  if (!app) return false;
  const provides = app._context.provides;
  const pinia = Object.getOwnPropertySymbols(provides).map((s) => provides[s]).find((v) => v && v._s instanceof Map);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__audio = this; return play.call(this); };
  window.__m = { router: app.config.globalProperties.$router, store: (id) => pinia._s.get(id) };
  return true;
})()`;

async function boot(offscreen) {
  const app = await launch({ offscreen });
  await app.waitFor(HELPER);
  // A never-shown window may not report ready-to-show, so don't block on it.
  const startup = (await Promise.race([app.ready, sleep(3000).then(() => ({}))])) ?? {};
  await app.waitFor(`!!document.querySelector(".table .row .play-btn")`);
  startup.homeMs = await app.exec(`performance.now()`);
  startup.fcpMs = await app.exec(`performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null`);
  return { app, startup };
}

async function startPlaying(app, selector = ".table .row .play-btn") {
  await app.exec(`document.querySelector(${JSON.stringify(selector)}).click(), true`);
  await app.waitFor(`__m.store("player").state === "playing" && !!window.__audio && !__audio.paused`);
  // Repeat-one keeps the same track looping, so a short mock track ending
  // mid-sample doesn't add a WAV render to the numbers.
  await app.exec(`__m.store("player").repeat = "one", true`);
}

/**
 * GPU time per pid in ns, from the Metal clients macOS lists in the IO registry.
 * getAppMetrics only reports the GPU process's CPU time, which misses the cost
 * of work that runs on the GPU itself, like large blur filters.
 */
function gpuTime() {
  const out = execFileSync("ioreg", ["-r", "-c", "AGXDeviceUserClient", "-l"], { encoding: "utf8", maxBuffer: 64 << 20 });
  const byPid = new Map();
  let pid = null;
  for (const line of out.split("\n")) {
    const creator = line.match(/"IOUserClientCreator" = "pid (\d+)/);
    if (creator) pid = Number(creator[1]);
    else if (pid != null && line.includes('"AppUsage"')) {
      const total = [...line.matchAll(/"accumulatedGPUTime"=(\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
      byPid.set(pid, (byPid.get(pid) ?? 0) + total);
    }
  }
  return byPid;
}

const audioClock = (app) => app.exec(`window.__audio ? { t: __audio.currentTime, paused: __audio.paused } : null`);
const jsHeap = (app) => app.exec(`(window.gc?.(), performance.memory.usedJSHeapSize)`);

/** Samples metrics once a second and summarises CPU and memory per process type. */
async function sample(app, tag, secs = seconds) {
  const pids = (await app.metrics(`${tag}:reset`)).processes.map((p) => p.pid);
  const before = await audioClock(app);
  const gpuBefore = gpuTime();
  const t0 = performance.now();
  const samples = [];
  for (let i = 0; i < secs; i++) {
    await sleep(1000);
    samples.push(await app.metrics(tag));
  }
  const gpuAfter = gpuTime();
  const elapsedNs = (performance.now() - t0) * 1e6;
  const gpuNs = pids.reduce((sum, pid) => sum + ((gpuAfter.get(pid) ?? 0) - (gpuBefore.get(pid) ?? 0)), 0);
  const after = await audioClock(app);
  const heap = await jsHeap(app);
  return summarise(samples, {
    gpuBusy: (gpuNs / elapsedNs) * 100,
    visibility: await app.exec(`document.visibilityState`),
    audio: before && after ? { advanced: +(after.t - before.t).toFixed(2), paused: after.paused } : null,
    jsHeapMB: heap / 1048576,
  });
}

function kind(p) {
  if (p.type === "Browser") return "browser";
  if (p.type === "Tab") return "renderer";
  if (p.type === "GPU") return "gpu";
  if (/audio/i.test(p.name)) return "audio";
  return "other";
}

function summarise(samples, extra) {
  const kinds = ["browser", "renderer", "gpu", "audio", "other"];
  const cpu = Object.fromEntries(kinds.map((k) => [k, 0]));
  const mem = Object.fromEntries(kinds.map((k) => [k, 0]));
  let wakeups = 0;
  for (const s of samples) {
    for (const p of s.processes) {
      cpu[kind(p)] += p.cpu / samples.length;
      mem[kind(p)] += p.workingSetKB / 1024 / samples.length;
      wakeups += p.wakeups / samples.length;
    }
  }
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { cpu: { total: total(cpu), ...cpu }, memMB: { total: total(mem), ...mem }, wakeups, ...extra };
}

const scenarios = {
  a: { title: "Idle on Home", async run(app) {
    await sleep(settle * 1000);
    return sample(app, "a");
  } },
  b: { title: "Playing, Home visible", async run(app) {
    await startPlaying(app);
    await sleep(settle * 1000);
    return sample(app, "b");
  } },
  // The only scenario with a real (never shown) native window instead of offscreen rendering.
  c: { title: "Playing, window hidden", hidden: true, async run(app) {
    await startPlaying(app);
    await sleep(settle * 1000);
    return sample(app, "c");
  } },
  d: { title: "Playing, immersive open", async run(app) {
    await startPlaying(app);
    await app.exec(`__m.store("ui").immersive = true`);
    await sleep(settle * 1000);
    return sample(app, "d");
  } },
  e: { title: "Playing, Stream with ~30 waveforms", async run(app) {
    await app.exec(`__m.router.push("/stream"), true`);
    await app.waitFor(`document.querySelectorAll(".stream .item").length >= 15`);
    for (let i = 0; i < 10; i++) {
      const n = await app.exec(`document.querySelector(".content").scrollTo({ top: 1e6 }), document.querySelectorAll(".stream .item").length`);
      if (n >= 30) break;
      await sleep(700);
    }
    // Scroll to the middle and play the first track item on screen, so the
    // playing waveform is visible with the rest of the list mounted around it.
    await app.exec(`(() => {
      const box = document.querySelector(".content");
      const items = [...document.querySelectorAll(".stream .item")];
      box.scrollTo({ top: items[12].offsetTop - 80 });
      return true;
    })()`);
    await sleep(300);
    await app.exec(`(() => {
      const box = document.querySelector(".content").getBoundingClientRect();
      const btn = [...document.querySelectorAll(".stream .item .play")].find((b) => {
        const r = b.getBoundingClientRect();
        return r.top > box.top && r.bottom < box.bottom;
      });
      btn.click();
      return true;
    })()`);
    await app.waitFor(`__m.store("player").state === "playing" && !__audio.paused`);
    await app.exec(`__m.store("player").repeat = "one", true`);
    const waveforms = await app.exec(`document.querySelectorAll(".stream .waveform").length`);
    await sleep(settle * 1000);
    return { ...(await sample(app, "e")), waveforms };
  } },
  f: { title: "After 15 pages and 10 tracks", async run(app) {
    await sleep(settle * 1000);
    const start = await sample(app, "f:start", 5);
    const pages = [
      "/stream", "/library/likes", "/library/playlists", "/library/albums", "/library/following",
      "/library/history", "/track/t3", "/user/u2", "/playlist/p1", "/playlist/p9",
      "/search?q=neon", "/user/u5", "/track/t20", "/settings", "/",
    ];
    await app.exec(`__m.router.push("/"), true`);
    await app.waitFor(`!!document.querySelector(".table .row .play-btn")`);
    await app.exec(`document.querySelector(".table .row .play-btn").click(), true`);
    for (let i = 0; i < pages.length; i++) {
      await app.exec(`__m.router.push(${JSON.stringify(pages[i])}), true`);
      await sleep(1200);
      if (i < 10) {
        await app.exec(`__m.store("player").next(), true`);
        if (i % 3 === 0) await app.exec(`__m.store("ui").immersive = true`);
        await sleep(800);
        await app.exec(`__m.store("ui").immersive = false`);
      }
    }
    await app.exec(`__m.store("player").toggle(), true`);
    await sleep(settle * 1000);
    const end = await sample(app, "f:end", 10);
    return { ...end, start, growthMB: end.memMB.total - start.memMB.total, heapGrowthMB: end.jsHeapMB - start.jsHeapMB };
  } },
};

const only = (args.only ?? Object.keys(scenarios).join(",")).split(",");
const results = { label, seconds, runs, machine: `${os.cpus()[0].model}, ${os.totalmem() / 2 ** 30} GB`, startup: [], scenarios: {} };

for (let r = 0; r < runs; r++) {
  for (const id of only) {
    const scenario = scenarios[id];
    if (!scenario) throw new Error(`unknown scenario ${id}`);
    process.stderr.write(`[${label}] run ${r + 1}/${runs} ${id}: ${scenario.title}\n`);
    const { app, startup } = await boot(!scenario.hidden);
    if (!scenario.hidden) results.startup.push(startup);
    try {
      const result = await scenario.run(app);
      (results.scenarios[id] ??= { title: scenario.title, runs: [] }).runs.push(result);
    } finally {
      await app.quit();
    }
  }
}

const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const fmt = (n, d = 1) => (n == null ? "" : n.toFixed(d));
console.log(`\n${label} on ${results.machine}, ${seconds}s per scenario, ${runs} run(s)\n`);
console.log("| Scenario | CPU % total | renderer | GPU proc | browser | audio | GPU busy % | wakeups/s | Memory MB total | renderer | GPU | browser | JS heap MB | audio advanced s | page |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [id, s] of Object.entries(results.scenarios)) {
  const m = (pick) => mean(s.runs.map(pick));
  const row = [
    `${id} ${s.title}`,
    fmt(m((x) => x.cpu.total)), fmt(m((x) => x.cpu.renderer)), fmt(m((x) => x.cpu.gpu)), fmt(m((x) => x.cpu.browser)), fmt(m((x) => x.cpu.audio)),
    fmt(m((x) => x.gpuBusy)),
    fmt(m((x) => x.wakeups), 0),
    fmt(m((x) => x.memMB.total), 0), fmt(m((x) => x.memMB.renderer), 0), fmt(m((x) => x.memMB.gpu), 0), fmt(m((x) => x.memMB.browser), 0),
    fmt(m((x) => x.jsHeapMB)),
    s.runs[0].audio ? fmt(m((x) => x.audio?.advanced ?? 0)) : "",
    [...new Set(s.runs.map((x) => x.visibility))].join("/"),
  ];
  console.log(`| ${row.join(" | ")} |`);
  if (id === "f") console.log(`\nf: total memory ${fmt(m((x) => x.start.memMB.total), 0)} -> ${fmt(m((x) => x.memMB.total), 0)} MB (${fmt(m((x) => x.growthMB), 0)}), JS heap ${fmt(m((x) => x.start.jsHeapMB))} -> ${fmt(m((x) => x.jsHeapMB))} MB`);
}
console.log(
  `\nStartup: ready-to-show ${fmt(mean(results.startup.map((s) => s.mainMs)), 0)} ms after main started, ` +
  `first contentful paint ${fmt(mean(results.startup.map((s) => s.fcpMs ?? 0)), 0)} ms, ` +
  `Home rendered ${fmt(mean(results.startup.map((s) => s.homeMs)), 0)} ms after renderer navigation start`,
);
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\nRaw samples: ${rawFile}\nSummary: ${outFile}`);
