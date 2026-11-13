// Measurement hook for scripts/measure.mjs. main.cjs only loads this when
// STRATUS_MEASURE=1. The window is never put on screen: it stays hidden, or
// with STRATUS_MEASURE_OFFSCREEN=1 it renders offscreen so "visible" scenarios
// still paint. Commands arrive as JSON lines on stdin, answers go to stdout as
// "@@measure {json}" lines, and each metrics sample is appended to
// STRATUS_MEASURE_OUT when that's set. See docs/performance.md.
const { app } = require("electron");
const fs = require("node:fs");
const readline = require("node:readline");

// A throwaway profile keeps runs comparable and keeps test history out of the real one.
if (process.env.STRATUS_MEASURE_PROFILE) app.setPath("userData", process.env.STRATUS_MEASURE_PROFILE);
// Lets the harness call gc() before reading the JS heap.
app.commandLine.appendSwitch("js-flags", "--expose-gc");
// Playback still decodes and runs the audio pipeline, but nothing reaches the speakers.
app.commandLine.appendSwitch("mute-audio");
// No dock icon and no activation, so a run never takes focus. Done before
// ready too, so the icon doesn't flash in the dock at launch.
const background = () => {
  app.setActivationPolicy?.("accessory");
  app.dock?.hide();
};
background();
app.whenReady().then(background);

const offscreen = process.env.STRATUS_MEASURE_OFFSCREEN === "1";
const webPreferences = offscreen ? { offscreen: true } : {};

const out = process.env.STRATUS_MEASURE_OUT;
const reply = (message) => process.stdout.write(`@@measure ${JSON.stringify(message)}\n`);

function metrics(label) {
  const sample = {
    t: Date.now(),
    label,
    processes: app.getAppMetrics().map((p) => ({
      pid: p.pid,
      type: p.type,
      name: p.serviceName || p.name || "",
      cpu: p.cpu.percentCPUUsage,
      wakeups: p.cpu.idleWakeupsPerSecond,
      workingSetKB: p.memory.workingSetSize,
      peakKB: p.memory.peakWorkingSetSize,
    })),
  };
  if (out) fs.appendFileSync(out, `${JSON.stringify(sample)}\n`);
  return sample;
}

function attach(win) {
  // Every path in main.cjs that would put the window on screen goes through
  // one of these, so turning them into no-ops keeps the run invisible.
  for (const method of ["show", "showInactive", "focus", "moveTop", "restore"]) win[method] = () => {};
  if (offscreen) win.webContents.setFrameRate(60);
  win.once("ready-to-show", () => reply({ event: "ready-to-show", ms: performance.now() }));

  async function handle(message) {
    switch (message.cmd) {
      case "exec":
        return win.webContents.executeJavaScript(message.js, true);
      case "metrics":
        return metrics(message.label);
      case "capture": {
        // Offscreen pages can still be captured, for checking visuals without a window.
        const image = await win.webContents.capturePage();
        fs.writeFileSync(message.path, image.toPNG());
        return message.path;
      }
      case "quit":
        setImmediate(() => app.exit(0));
        return true;
      default:
        throw new Error(`unknown command ${message.cmd}`);
    }
  }

  readline.createInterface({ input: process.stdin }).on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    try {
      reply({ id: message.id, result: await handle(message) });
    } catch (err) {
      reply({ id: message.id, error: String(err?.message ?? err) });
    }
  });
}

module.exports = { attach, webPreferences };
