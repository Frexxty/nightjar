import { defineStore } from "pinia";
import { ref } from "vue";
import { useUi } from "@/stores/ui";

const isMac = window.stratus?.platform === "darwin";
// macOS restarts on its own after a short countdown, like DaUpdatea does.
const RESTART_COUNTDOWN = 5;

export const useUpdates = defineStore("updates", () => {
  const ui = useUi();
  const bridge = window.stratus?.updates;
  const info = ref<UpdateInfo | null>(null);
  const state = ref<UpdateState>({ status: "idle" });
  const dialog = ref(false);
  const countdown = ref<number | null>(null);
  // Set while a check the user asked for is running, so we report "up to
  // date" for it and ignore their skipped version.
  let manual = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    if (!bridge) return;
    info.value = await bridge.getInfo();
  }

  function onState(next: UpdateState) {
    state.value = next;
    void refresh();
    if (next.status === "available") {
      if (manual || next.version !== info.value?.skippedVersion) dialog.value = true;
      manual = false;
    } else if (next.status === "not-available") {
      if (manual) ui.notify(`Stratus ${info.value?.currentVersion ?? ""} is the latest version`);
      manual = false;
    } else if (next.status === "error" && manual) {
      dialog.value = true;
      manual = false;
    }
  }

  async function init() {
    if (!bridge) return;
    bridge.onState(onState);
    await refresh();
    if (info.value) state.value = info.value.state;
  }

  async function check(userInitiated = true) {
    if (!bridge) return;
    if (!info.value?.enabled) {
      if (userInitiated) ui.notify("Updates are turned off in development builds");
      return;
    }
    manual = userInitiated;
    if (["downloading", "downloaded"].includes(state.value.status)) {
      dialog.value = true;
      manual = false;
      return;
    }
    await bridge.check();
  }

  function download() {
    void bridge?.download();
  }

  function install() {
    if (!bridge) return;
    if (!isMac) return void bridge.install();
    countdown.value = RESTART_COUNTDOWN;
    clearInterval(timer);
    timer = setInterval(() => {
      if (countdown.value === null) return clearInterval(timer);
      countdown.value -= 1;
      if (countdown.value <= 0) {
        clearInterval(timer);
        countdown.value = null;
        void bridge.install();
      }
    }, 1000);
  }

  function cancelRestart() {
    clearInterval(timer);
    countdown.value = null;
  }

  function later() {
    cancelRestart();
    dialog.value = false;
  }

  async function skip() {
    if (!bridge || !state.value.version) return;
    info.value = await bridge.skip(state.value.version);
    later();
  }

  async function setBeta(beta: boolean) {
    if (!bridge) return;
    info.value = await bridge.setBeta(beta);
  }

  return { info, state, dialog, countdown, init, check, download, install, cancelRestart, later, skip, setBeta };
});
