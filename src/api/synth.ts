// Small deterministic synth so the mock backend has something real to play.
// Each track gets an arrangement (sections with an energy level); the audio and
// the waveform both come from that arrangement, so the waveform matches what you hear.

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Arrangement {
  seed: number;
  bpm: number;
  seconds: number;
  root: number;
  /** Energy per bar, 0..1. */
  bars: number[];
}

export function arrange(seed: number, bpm: number, seconds: number): Arrangement {
  const r = rng(seed);
  const barSeconds = (60 / bpm) * 4;
  const count = Math.max(4, Math.floor(seconds / barSeconds));
  const shape = [0.35, 0.55, 0.9, 0.5, 1, 0.3];
  const bars: number[] = [];
  let section = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % 4 === 0) section = Math.min(shape.length - 1, section + (r() < 0.8 ? 1 : 0));
    const fade = i >= count - 2 ? 0.45 : 1;
    bars.push(Math.min(1, shape[section] * fade * (0.85 + r() * 0.2)));
  }
  return { seed, bpm, seconds: count * barSeconds, root: 45 + Math.floor(r() * 12), bars };
}

export function waveformFor(a: Arrangement, points = 180): number[] {
  const r = rng(a.seed ^ 0x9e3779b9);
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const bar = a.bars[Math.min(a.bars.length - 1, Math.floor((i / points) * a.bars.length))];
    const beat = (i * 7) % 4 === 0 ? 0.12 : 0;
    out.push(Math.max(0.06, Math.min(1, bar * 0.8 + beat + r() * 0.18)));
  }
  return out;
}

const SCALE = [0, 2, 3, 5, 7, 8, 10];
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 4, 4], [5, 3, 0, 4], [0, 4, 5, 3]];
const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function renderWav(a: Arrangement): Blob {
  const rate = 22050;
  const length = Math.floor(a.seconds * rate);
  const data = new Float32Array(length);
  const r = rng(a.seed);
  const prog = PROGRESSIONS[a.seed % PROGRESSIONS.length];
  const beat = 60 / a.bpm;
  const bar = beat * 4;
  const sixteenth = beat / 4;
  const arpPattern = [0, 2, 4, 2, 0, 4, 2, 4].map((n) => n + (r() < 0.3 ? 7 : 0));

  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const barIndex = Math.floor(t / bar);
    const energy = a.bars[Math.min(barIndex, a.bars.length - 1)];
    const degree = prog[barIndex % prog.length];
    const chord = [0, 2, 4].map((step) => {
      const idx = degree + step;
      return a.root + 12 + SCALE[idx % 7] + 12 * Math.floor(idx / 7);
    });

    // Pad: three detuned sines, always present.
    let pad = 0;
    for (const note of chord) pad += Math.sin(2 * Math.PI * freq(note) * t) + 0.5 * Math.sin(2 * Math.PI * freq(note) * 1.003 * t);
    let sample = pad * 0.045;

    // Arpeggio on sixteenths once the track has some energy.
    if (energy > 0.45) {
      const step = Math.floor(t / sixteenth);
      const pos = (t % sixteenth) / sixteenth;
      const n = arpPattern[step % arpPattern.length];
      const note = a.root + 24 + SCALE[(degree + n) % 7] + 12 * Math.floor((degree + n) / 7);
      const env = Math.exp(-pos * 5);
      const ph = 2 * Math.PI * freq(note) * t;
      sample += (Math.sin(ph) + 0.3 * Math.sin(3 * ph)) * env * 0.08 * energy;
    }

    // Bass on every beat.
    const beatPos = (t % beat) / beat;
    if (energy > 0.3) {
      const bassNote = a.root + SCALE[degree % 7];
      sample += Math.sin(2 * Math.PI * freq(bassNote) * t) * Math.exp(-beatPos * 2.5) * 0.18 * energy;
    }

    // Kick and hats in the louder sections.
    if (energy > 0.5) {
      const kickT = t % beat;
      sample += Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-kickT * 30)) * kickT) * Math.exp(-kickT * 9) * 0.45 * energy;
      const hatT = (t + beat / 2) % beat;
      if (hatT < 0.04) sample += (r() * 2 - 1) * Math.exp(-hatT * 120) * 0.12 * energy;
    }

    const fade = Math.min(1, t / 1.5, (a.seconds - t) / 3);
    data[i] = Math.tanh(sample * 1.4) * 0.8 * fade;
  }

  return encodeWav(data, rate);
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const PALETTES = [
  ["#ff5500", "#ff9a3c", "#2b0f3a"],
  ["#5b2bff", "#00d4ff", "#0b0b1f"],
  ["#ff2e63", "#ffd166", "#1a1033"],
  ["#00c896", "#a3ff6f", "#082a2a"],
  ["#ff7ad9", "#7a5cff", "#160a24"],
  ["#ffcc00", "#ff5e5e", "#24130a"],
  ["#3ad1ff", "#2b59ff", "#071226"],
  ["#e0e0e0", "#7d7d7d", "#111111"],
];

/** Generated cover art as an SVG data URL. */
export function artwork(seed: number, label = ""): string {
  const r = rng(seed);
  const [a, b, bg] = PALETTES[seed % PALETTES.length];
  const shapes: string[] = [];
  const style = seed % 3;
  for (let i = 0; i < 5; i++) {
    const x = Math.round(r() * 300), y = Math.round(r() * 300), s = Math.round(60 + r() * 160);
    const fill = i % 2 ? a : b;
    const op = (0.35 + r() * 0.5).toFixed(2);
    if (style === 0) shapes.push(`<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${fill}" opacity="${op}"/>`);
    else if (style === 1) shapes.push(`<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" transform="rotate(${Math.round(r() * 90)} ${x} ${y})" fill="${fill}" opacity="${op}"/>`);
    else shapes.push(`<path d="M0 ${y} Q150 ${y - s} 300 ${y + s / 3} L300 300 L0 300Z" fill="${fill}" opacity="${op}"/>`);
  }
  const text = label
    ? `<text x="20" y="276" font-family="-apple-system,Helvetica,Arial" font-size="22" font-weight="700" fill="#fff" opacity="0.9">${label.replace(/[<&"]/g, "")}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs><rect width="300" height="300" fill="${bg}"/><g filter="url(#b)">${shapes.join("")}</g>${text}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
