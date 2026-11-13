(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const RELEASES = "https://github.com/Frexxty/stratus/releases";

  /* ---------- OS detection and download buttons ---------- */

  function detectOS() {
    const ua = navigator.userAgent || "";
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return "other";
    if (/Win/i.test(platform) || /Windows NT/i.test(ua)) return "windows";
    if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) {
      // iPadOS Safari reports itself as a Mac. Real Macs have no touch points.
      return navigator.maxTouchPoints > 1 ? "other" : "mac";
    }
    return "other";
  }

  async function detectMacArch() {
    // Only Chromium exposes this. Everyone else gets the Apple Silicon default.
    try {
      const uad = navigator.userAgentData;
      if (uad && uad.getHighEntropyValues) {
        const { architecture } = await uad.getHighEntropyValues(["architecture"]);
        if (architecture === "x86") return "intel";
      }
    } catch (_) { /* ignore */ }
    return "arm";
  }

  function link(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    return a;
  }

  function renderDownloads(os, arch) {
    document.querySelectorAll("[data-dl]").forEach((block) => {
      const mac = block.querySelector('[data-dl-btn="mac"]');
      const win = block.querySelector('[data-dl-btn="windows"]');
      const detail = block.querySelector("[data-dl-detail]");
      const alt = block.querySelector("[data-dl-alt]");
      const links = [];

      if (os === "mac") {
        win.hidden = true;
        mac.href = arch === "intel" ? "/download/mac-intel" : "/download/mac";
        detail.textContent = arch === "intel" ? "macOS, Intel" : "macOS, Apple Silicon";
        links.push(arch === "intel"
          ? link("/download/mac", "Mac with Apple Silicon")
          : link("/download/mac-intel", "Mac with Intel chip"));
        links.push(link("/download/windows", "Windows"));
      } else if (os === "windows") {
        mac.hidden = true;
        detail.textContent = "Windows, 64-bit";
        links.push(link("/download/mac", "Mac with Apple Silicon"));
        links.push(link("/download/mac-intel", "Mac with Intel chip"));
      } else {
        links.push(link("/download/mac-intel", "Mac with Intel chip"));
      }
      links.push(link(RELEASES, "All releases"));
      alt.replaceChildren(...links);
    });

  }

  async function showVersion() {
    try {
      const res = await fetch("/api/latest", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.version) return;
      document.querySelectorAll("[data-dl-version]").forEach((el) => {
        el.textContent = "v" + data.version;
        el.hidden = false;
      });
    } catch (_) { /* leave it hidden */ }
  }

  const os = detectOS();
  renderDownloads(os, "arm");
  if (os === "mac") detectMacArch().then((arch) => { if (arch !== "arm") renderDownloads(os, arch); });
  showVersion();

  /* ---------- Nav border on scroll ---------- */

  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Reveal on scroll ---------- */

  const reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
    // The hero is above the fold, so animate it in straight away.
    requestAnimationFrame(() => document.querySelectorAll(".hero .reveal").forEach((el) => el.classList.add("in")));
  }

  /* ---------- Waveform demo ---------- */

  const demo = document.querySelector("[data-wave-demo]");
  if (demo) waveDemo(demo);

  function waveDemo(root) {
    const DURATION = 90;
    const SPEED = 2.5;
    const ROW = 37;
    const comments = [
      { t: 6, who: "Gloam", text: "need this on vinyl", c: "#8a5a3c" },
      { t: 11, who: "Celeste Varga", text: "perfect late-night track", c: "#d0703a" },
      { t: 16, who: "Marrow & Moss", text: "saw this live last month, insane", c: "#b38a5a" },
      { t: 24, who: "Nadia Sol", text: "underrated", c: "#2e9b6a" },
      { t: 32, who: "Static Orchard", text: "THIS PART", c: "#6a6a70" },
      { t: 38, who: "Static Orchard", text: "love the switch-up", c: "#6a6a70" },
      { t: 43, who: "Low Tide Club", text: "production is so clean", c: "#7a4aa0" },
      { t: 53, who: "Lumen Drift", text: "absolutely unreal", c: "#9a4ac0" },
      { t: 57, who: "Unit 404", text: "ok this is my favourite bit", c: "#3a6ad0" },
      { t: 66, who: "Kōri", text: "pure vibes", c: "#4cc06a" },
      { t: 74, who: "Rooftop Weather", text: "the pads are so warm", c: "#22a8d8" },
      { t: 82, who: "Moth Choir", text: "on repeat all week", c: "#2a8ae0" },
    ];

    const wave = root.querySelector("[data-wd-wave]");
    const bars = root.querySelector("[data-wd-bars]");
    const played = root.querySelector("[data-wd-played]");
    const pins = root.querySelector("[data-wd-pins]");
    const list = root.querySelector("[data-wd-list]");
    const timeEl = root.querySelector("[data-wd-time]");

    // Deterministic, song-shaped bar heights: an intro, a build, a drop and an outro.
    const N = 84;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const frag1 = document.createDocumentFragment();
    const frag2 = document.createDocumentFragment();
    for (let i = 0; i < N; i++) {
      const x = i / N;
      const env = 0.35 + 0.35 * Math.min(1, x * 3) + 0.25 * (x > 0.45 && x < 0.8 ? 1 : 0) - 0.3 * Math.max(0, x - 0.85) * 4;
      const h = Math.max(0.12, Math.min(1, env * (0.6 + 0.4 * rand()) + 0.08 * Math.sin(i * 1.7)));
      const a = document.createElement("i");
      a.style.height = (h * 100).toFixed(1) + "%";
      frag1.appendChild(a);
      frag2.appendChild(a.cloneNode());
    }
    bars.appendChild(frag1);
    played.appendChild(frag2);

    const pinEls = comments.map((c) => {
      const p = document.createElement("i");
      p.style.left = (c.t / DURATION * 100).toFixed(2) + "%";
      p.style.setProperty("--c", c.c);
      pins.appendChild(p);
      return p;
    });

    const items = comments.map((c) => {
      const li = document.createElement("li");
      const small = document.createElement("small");
      const b = document.createElement("b");
      b.textContent = c.who;
      small.append(b, " at " + fmt(c.t));
      const span = document.createElement("span");
      span.textContent = c.text;
      li.append(small, span);
      list.appendChild(li);
      return li;
    });

    let t = reduceMotion ? 17 : 0;
    let current = -2;
    let lastSecond = -1;
    let playing = !reduceMotion;
    let visible = false;
    let last = 0;

    function fmt(s) {
      s = Math.floor(s);
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }

    function render() {
      wave.style.setProperty("--p", (t / DURATION * 100).toFixed(2) + "%");
      const sec = Math.floor(t);
      if (sec !== lastSecond) {
        lastSecond = sec;
        timeEl.textContent = fmt(t);
        wave.setAttribute("aria-valuenow", String(sec));
        wave.setAttribute("aria-valuetext", fmt(t));
      }
      let idx = -1;
      for (let i = 0; i < comments.length; i++) if (comments[i].t <= t) idx = i;
      if (idx !== current) {
        if (current >= 0) { items[current].classList.remove("on"); pinEls[current].classList.remove("on"); }
        if (idx >= 0) { items[idx].classList.add("on"); pinEls[idx].classList.add("on"); }
        current = idx;
        // Keep the active comment on the middle line, like synced lyrics.
        const row = Math.max(idx, 0);
        list.style.transform = `translateY(${(1 - row) * ROW}px)`;
      }
    }

    function frame(now) {
      if (!playing || !visible) { last = 0; return; }
      if (last) t += ((now - last) / 1000) * SPEED;
      last = now;
      if (t >= DURATION) t = 0;
      render();
      requestAnimationFrame(frame);
    }

    function start() {
      if (playing && visible) requestAnimationFrame(frame);
    }

    function seekTo(clientX) {
      const r = wave.getBoundingClientRect();
      t = Math.min(DURATION - 0.01, Math.max(0, ((clientX - r.left) / r.width) * DURATION));
      render();
    }

    let dragging = false;
    wave.addEventListener("pointerdown", (e) => {
      dragging = true;
      wave.setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    });
    wave.addEventListener("pointermove", (e) => { if (dragging) seekTo(e.clientX); });
    wave.addEventListener("pointerup", () => { dragging = false; });
    wave.addEventListener("pointercancel", () => { dragging = false; });
    wave.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        t = Math.min(DURATION - 0.01, Math.max(0, t + (e.key === "ArrowRight" ? 5 : -5)));
        render();
      }
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        const was = visible;
        visible = entries[0].isIntersecting;
        if (visible && !was) start();
      }).observe(root);
    } else {
      visible = true;
      start();
    }

    render();
  }
})();
