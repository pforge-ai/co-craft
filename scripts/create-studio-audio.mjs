// Cinema-grade procedural 48 kHz 16-bit stereo masters for CoCraft's bundled offline studio audio.
// Uses deterministic pink noise, time-varying biquad filters, felt-mallet / Karplus-style voices,
// and Freeverb stereo hall diffusion — zero harsh raw-sine test tones or external samples.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const target = fileURLToPath(new URL('../resources/public/studio/', import.meta.url));
const RATE = 48000;
const TAU = 2 * Math.PI;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPinkNoise(seed) {
  const rand = mulberry32(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    return out;
  };
}

// Smooth Chamberlin state-variable filter (stable under fast frequency sweeps, zero zipper clicks).
function createSVF() {
  let low = 0;
  let band = 0;
  return (x, freqHz, q = 0.8, mode = 'lp') => {
    const f = 2 * Math.sin((Math.PI * Math.min(Math.max(freqHz, 20), RATE * 0.42)) / RATE);
    const damp = 1 / Math.max(0.5, q);
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    if (mode === 'hp') return high;
    if (mode === 'bp') return band;
    return low;
  };
}

// Freeverb-inspired stereo algorithmic hall reverb (4 parallel damped combs + 2 series allpasses per ch).
function applyStereoReverb(left, right, { wet = 0.3, room = 0.82, damp = 0.48 } = {}) {
  const n = left.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const combBase = [1116, 1188, 1277, 1356];
  const allpassBase = [556, 441];
  const spread = 23;

  const makeChannel = (offset) => ({
    combs: combBase.map((len) => ({
      buf: new Float32Array(len + offset),
      idx: 0,
      store: 0,
    })),
    allpasses: allpassBase.map((len) => ({
      buf: new Float32Array(len + offset),
      idx: 0,
    })),
    hp: createSVF(),
  });

  const chL = makeChannel(0);
  const chR = makeChannel(spread);

  const stepCh = (ch, input) => {
    let acc = 0;
    for (const c of ch.combs) {
      const y = c.buf[c.idx];
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.idx] = input + c.store * room;
      c.idx = (c.idx + 1) % c.buf.length;
      acc += y;
    }
    let y = acc * 0.25;
    for (const ap of ch.allpasses) {
      const bufOut = ap.buf[ap.idx];
      ap.buf[ap.idx] = y + bufOut * 0.5;
      ap.idx = (ap.idx + 1) % ap.buf.length;
      y = bufOut - y;
    }
    // Keep reverb return clean below 130 Hz so low-end stays tight.
    return ch.hp(y, 130, 0.72, 'hp');
  };

  for (let i = 0; i < n; i++) {
    const monoIn = (left[i] + right[i]) * 0.5;
    const wL = stepCh(chL, monoIn * 0.6 + left[i] * 0.4);
    const wR = stepCh(chR, monoIn * 0.6 + right[i] * 0.4);
    outL[i] = left[i] * (1 - wet * 0.45) + wL * wet;
    outR[i] = right[i] * (1 - wet * 0.45) + wR * wet;
  }
  return [outL, outR];
}

// Gentle DC blocker + soft analog saturation + target peak normalization + clean edge fades.
function masterStereo(left, right, { targetPeak = 0.72, fadeIn = 0.015, fadeOut = 0.08, drive = 1.15 } = {}) {
  const n = left.length;
  let prevInL = 0, prevOutL = 0;
  let prevInR = 0, prevOutR = 0;
  let peak = 1e-6;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const inSamples = Math.max(1, Math.round(fadeIn * RATE));
  const outSamples = Math.max(1, Math.round(fadeOut * RATE));

  for (let i = 0; i < n; i++) {
    // 1-pole DC blocker (~16 Hz)
    const dcL = left[i] - prevInL + 0.9978 * prevOutL;
    prevInL = left[i];
    prevOutL = dcL;
    const dcR = right[i] - prevInR + 0.9978 * prevOutR;
    prevInR = right[i];
    prevOutR = dcR;

    const envIn = i < inSamples ? Math.sin((i / inSamples) * Math.PI * 0.5) : 1;
    const envOut = i >= n - outSamples ? Math.sin(((n - 1 - i) / outSamples) * Math.PI * 0.5) : 1;
    const env = Math.max(0, envIn * envOut);

    const sL = Math.tanh(dcL * drive) * env;
    const sR = Math.tanh(dcR * drive) * env;
    outL[i] = sL;
    outR[i] = sR;
    peak = Math.max(peak, Math.abs(sL), Math.abs(sR));
  }

  const gain = targetPeak / peak;
  for (let i = 0; i < n; i++) {
    outL[i] *= gain;
    outR[i] *= gain;
  }
  return [outL, outR];
}

function addPanned(left, right, i, sample, pan = 0) {
  const angle = ((pan + 1) * Math.PI) / 4;
  left[i] += sample * Math.cos(angle);
  right[i] += sample * Math.sin(angle);
}

// Soft studio felt-piano / muted Rhodes voice with delicate hammer thump & natural harmonic roll-off.
function renderFeltNote(left, right, { startSec, freq, durSec = 2.6, gain = 0.22, pan = 0, seed = 1, brightness = 1 }) {
  const start = Math.round(startSec * RATE);
  const len = Math.min(left.length - start, Math.round(durSec * RATE));
  if (len <= 0 || start < 0) return;
  const pink = createPinkNoise(seed);
  const lp = createSVF();
  const hammerLp = createSVF();
  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const atk = 1 - Math.exp(-t / 0.008);
    const bodyEnv = atk * Math.exp(-t * 1.45);
    // Warm fundamental + damped 2nd/3rd harmonics (felt hammers damp high partials rapidly)
    const sig =
      Math.sin(TAU * freq * t) +
      0.28 * brightness * Math.sin(TAU * freq * 2.0007 * t + 0.2) * Math.exp(-t * 3.8) +
      0.08 * brightness * Math.sin(TAU * freq * 3.002 * t + 0.7) * Math.exp(-t * 7.5) +
      0.03 * brightness * Math.sin(TAU * freq * 4.006 * t) * Math.exp(-t * 11);
    const hammer = hammerLp(pink(), 480, 0.7, 'lp') * Math.exp(-t * 85) * 0.35;
    const warm = lp(sig * bodyEnv + hammer, Math.min(2400, freq * (3.2 + 2.2 * Math.exp(-t * 4))), 0.65, 'lp');
    addPanned(left, right, start + k, warm * gain, pan);
  }
}

// Soft wooden/felt marimba pluck (for crisp documentary pulse bed).
function renderMarimbaPluck(left, right, { startSec, freq, durSec = 0.7, gain = 0.16, pan = 0, seed = 2 }) {
  const start = Math.round(startSec * RATE);
  const len = Math.min(left.length - start, Math.round(durSec * RATE));
  if (len <= 0 || start < 0) return;
  const pink = createPinkNoise(seed);
  const malletLp = createSVF();
  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const atk = 1 - Math.exp(-t / 0.003);
    const tone =
      atk * Math.exp(-t * 6.8) * Math.sin(TAU * freq * t) +
      atk * Math.exp(-t * 18.0) * 0.22 * Math.sin(TAU * freq * 3.98 * t + 0.4);
    const mallet = malletLp(pink(), 950, 0.85, 'bp') * Math.exp(-t * 110) * 0.45;
    addPanned(left, right, start + k, (tone + mallet) * gain, pan);
  }
}

// Soft warm band-limited triangle/saw pad voice with slow low-pass breathing.
function renderWarmPadChord(left, right, { startSec, durSec, freqs, gain = 0.11, cutoffMin = 360, cutoffMax = 680 }) {
  const start = Math.round(startSec * RATE);
  const len = Math.min(left.length - start, Math.round(durSec * RATE));
  if (len <= 0 || start < 0) return;
  const lpL = createSVF();
  const lpR = createSVF();
  const detunes = [-0.0032, 0.0029];

  for (let k = 0; k < len; k++) {
    const t = k / RATE;
    const u = k / len;
    // Smooth cosine-bell crossfade envelope so chord transitions never click or pump
    const env = Math.sin(Math.min(1, t / 0.9) * Math.PI * 0.5) * Math.sin(Math.min(1, (durSec - t) / 1.1) * Math.PI * 0.5);
    let rawL = 0;
    let rawR = 0;
    for (let fIdx = 0; fIdx < freqs.length; fIdx++) {
      const f = freqs[fIdx];
      for (let d = 0; d < 2; d++) {
        const fL = f * (1 + detunes[d]);
        const fR = f * (1 - detunes[d] * 0.92);
        // Warm soft saw/tri hybrid (only first 5 harmonics, zero aliasing)
        let vL = 0, vR = 0;
        for (let h = 1; h <= 5; h++) {
          const w = 1 / (h * h * 0.85 + 0.15);
          vL += w * Math.sin(TAU * fL * h * t + fIdx * 1.1 + d);
          vR += w * Math.sin(TAU * fR * h * t + fIdx * 1.3 + d * 1.7);
        }
        rawL += vL * 0.22;
        rawR += vR * 0.22;
      }
    }
    const cutoff = cutoffMin + (cutoffMax - cutoffMin) * (0.5 - 0.5 * Math.cos(TAU * u));
    left[start + k] += lpL(rawL, cutoff, 0.68, 'lp') * env * gain;
    right[start + k] += lpR(rawR, cutoff * 1.03, 0.68, 'lp') * env * gain;
  }
}

// 1. slipstream.wav — True airy cinema whoosh (swept dual-band pink noise + subtle sub-air, zero sine whistle!)
function buildSlipstream() {
  const sec = 1.45;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const pinkL = createPinkNoise(101);
  const pinkR = createPinkNoise(202);
  const pinkAirL = createPinkNoise(303);
  const pinkAirR = createPinkNoise(404);
  const bpL1 = createSVF(), bpR1 = createSVF();
  const bpL2 = createSVF(), bpR2 = createSVF();
  const lpSub = createSVF();

  let subPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const peakAt = 0.56;
    const u = t < peakAt ? t / peakAt : 1 - (t - peakAt) / (sec - peakAt);
    const bell = t < peakAt ? Math.pow(Math.sin(u * Math.PI * 0.5), 1.8) : Math.pow(Math.max(0, u), 2.1);

    // Smooth airy frequency arch: low warm rush -> airy peak -> gentle breath tail
    const f1 = 170 + 1180 * Math.pow(bell, 1.35);
    const f2 = 460 + 2050 * Math.pow(bell, 1.6);

    const wL = bpL1(pinkL(), f1, 1.35, 'bp') * 0.85 + bpL2(pinkAirL(), f2, 1.55, 'bp') * 0.34;
    const wR = bpR1(pinkR(), f1 * 1.04, 1.35, 'bp') * 0.85 + bpR2(pinkAirR(), f2 * 0.96, 1.55, 'bp') * 0.34;

    // Gentle stereo motion left -> center -> right
    const pan = (t / sec - 0.5) * 0.55;
    const gL = Math.cos(((pan + 1) * Math.PI) / 4);
    const gR = Math.sin(((pan + 1) * Math.PI) / 4);

    // Warm sub-air pressure swell (barely felt, adds cinema weight)
    const subHz = 54 + 34 * bell;
    subPhase += (TAU * subHz) / RATE;
    const sub = lpSub(Math.sin(subPhase) * bell * bell * 0.14, 110, 0.7, 'lp');

    left[i] = wL * bell * gL * 1.15 + sub;
    right[i] = wR * bell * gR * 1.15 + sub;
  }

  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.24, room: 0.76, damp: 0.62 });
  // Smooth cinema air roll-off above 5.8 kHz so the whoosh feels silky, never hissy
  const airLpL = createSVF(), airLpR = createSVF();
  for (let i = 0; i < n; i++) {
    rL[i] = airLpL(rL[i], 5400, 0.72, 'lp');
    rR[i] = airLpR(rR[i], 5400, 0.72, 'lp');
  }
  return masterStereo(rL, rR, { targetPeak: 0.66, fadeIn: 0.03, fadeOut: 0.14, drive: 1.1 });
}

// 2. soft-impact.wav — Deep cinema sub-boom + muffled felt bass-drum transient + dark hall tail
function buildSoftImpact() {
  const sec = 1.5;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const pinkL = createPinkNoise(505);
  const pinkR = createPinkNoise(606);
  const lpL = createSVF(), lpR = createSVF();
  const lpBody = createSVF();

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 36 + 56 * Math.exp(-t * 14.5);
    phase += (TAU * freq) / RATE;
    const atk = 1 - Math.exp(-t / 0.005);
    const subEnv = atk * Math.exp(-t * 2.9);
    const sub = lpBody(Math.sin(phase) * subEnv + 0.18 * Math.sin(phase * 2) * Math.exp(-t * 9), 180, 0.7, 'lp');

    // Warm felt mallet thump transient (first 40ms)
    const thumpEnv = atk * Math.exp(-t * 36);
    const thumpL = lpL(pinkL(), 340, 0.75, 'lp') * thumpEnv * 0.65;
    const thumpR = lpR(pinkR(), 340, 0.75, 'lp') * thumpEnv * 0.65;

    left[i] = sub * 0.85 + thumpL;
    right[i] = sub * 0.85 + thumpR;
  }

  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.26, room: 0.82, damp: 0.65 });
  return masterStereo(rL, rR, { targetPeak: 0.76, fadeIn: 0.003, fadeOut: 0.16, drive: 1.25 });
}

// 3. glass-ident.wav — Refined studio celesta / felt-mallet brand sting (Dmaj9)
function buildGlassIdent() {
  const sec = 2.2;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  renderFeltNote(left, right, { startSec: 0.02, freq: 293.66, durSec: 2.0, gain: 0.22, pan: -0.22, seed: 701, brightness: 0.7 }); // D4 warm root
  renderFeltNote(left, right, { startSec: 0.03, freq: 587.33, durSec: 1.9, gain: 0.28, pan: -0.15, seed: 702, brightness: 1.05 }); // D5
  renderFeltNote(left, right, { startSec: 0.15, freq: 880.0, durSec: 1.8, gain: 0.24, pan: 0.14, seed: 703, brightness: 1.0 }); // A5
  renderFeltNote(left, right, { startSec: 0.28, freq: 1318.51, durSec: 1.75, gain: 0.16, pan: 0.26, seed: 704, brightness: 0.9 }); // E6 (maj9 shimmer)
  renderFeltNote(left, right, { startSec: 0.29, freq: 739.99, durSec: 1.7, gain: 0.14, pan: 0.0, seed: 705, brightness: 0.8 }); // F#5 warmth

  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.42, room: 0.86, damp: 0.42 });
  return masterStereo(rL, rR, { targetPeak: 0.72, fadeIn: 0.006, fadeOut: 0.28, drive: 1.08 });
}

// 4. warm-ambient.wav — 16s cinematic minimalist felt-piano + low-passed warm pad (Fmaj9 -> Dm9 -> Bbmaj7 -> C6/9)
function buildWarmAmbient() {
  const sec = 16.0;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  const chords = [
    { start: 0.0, dur: 4.5, pad: [174.61, 220.0, 261.63, 329.63], melody: [[0.15, 349.23, -0.2], [1.65, 392.0, 0.18], [2.85, 329.63, -0.1]] }, // Fmaj9
    { start: 3.9, dur: 4.5, pad: [146.83, 220.0, 261.63, 329.63], melody: [[4.15, 440.0, 0.22], [5.85, 349.23, -0.18], [7.0, 329.63, 0.1]] }, // Dm9
    { start: 7.9, dur: 4.5, pad: [116.54, 174.61, 220.0, 293.66], melody: [[8.2, 349.23, -0.24], [9.9, 293.66, 0.15], [11.1, 329.63, -0.08]] }, // Bbmaj7
    { start: 11.9, dur: 4.1, pad: [130.81, 196.0, 220.0, 293.66], melody: [[12.15, 392.0, 0.2], [13.7, 329.63, -0.15]] }, // C6/9
  ];

  let seed = 1000;
  for (const ch of chords) {
    renderWarmPadChord(left, right, {
      startSec: ch.start,
      durSec: ch.dur,
      freqs: ch.pad,
      gain: 0.14,
      cutoffMin: 340,
      cutoffMax: 620,
    });
    // Soft deep bass root note
    renderFeltNote(left, right, {
      startSec: ch.start + 0.05,
      freq: ch.pad[0] * 0.5,
      durSec: 3.8,
      gain: 0.16,
      pan: 0,
      seed: seed++,
      brightness: 0.45,
    });
    for (const [at, freq, pan] of ch.melody) {
      renderFeltNote(left, right, {
        startSec: at,
        freq,
        durSec: 3.2,
        gain: 0.18,
        pan,
        seed: seed++,
        brightness: 0.72,
      });
    }
  }

  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.46, room: 0.88, damp: 0.52 });
  return masterStereo(rL, rR, { targetPeak: 0.58, fadeIn: 0.45, fadeOut: 0.9, drive: 1.06 });
}

// 5. pulse-bed.wav — 12.8s modern documentary pulse @ 75 BPM (Am9 -> Fmaj7 -> Cmaj9 -> Em7)
function buildPulseBed() {
  const bpm = 75;
  const beat = 60 / bpm; // 0.8s
  const bar = beat * 4; // 3.2s
  const sec = bar * 4; // 12.8s
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  const bars = [
    { bass: 110.0, pad: [220.0, 261.63, 329.63, 392.0], arp: [329.63, 392.0, 493.88, 392.0, 329.63, 440.0, 392.0, 329.63] }, // Am9
    { bass: 87.31, pad: [174.61, 220.0, 261.63, 329.63], arp: [261.63, 329.63, 440.0, 329.63, 261.63, 392.0, 329.63, 261.63] }, // Fmaj7
    { bass: 130.81, pad: [196.0, 261.63, 329.63, 392.0], arp: [329.63, 392.0, 523.25, 392.0, 329.63, 440.0, 392.0, 329.63] }, // Cmaj9
    { bass: 82.41, pad: [164.81, 196.0, 246.94, 329.63], arp: [246.94, 329.63, 392.0, 329.63, 246.94, 392.0, 329.63, 293.66] }, // Em7
  ];

  let seed = 2000;
  for (let b = 0; b < bars.length; b++) {
    const startSec = b * bar;
    const spec = bars[b];
    // Warm subtle pad glue
    renderWarmPadChord(left, right, {
      startSec,
      durSec: bar + 0.35,
      freqs: spec.pad,
      gain: 0.085,
      cutoffMin: 360,
      cutoffMax: 580,
    });
    // Soft muted analog bass pulse on quarter notes
    for (let q = 0; q < 4; q++) {
      renderFeltNote(left, right, {
        startSec: startSec + q * beat,
        freq: spec.bass,
        durSec: beat * 1.15,
        gain: q === 0 ? 0.24 : 0.16,
        pan: 0,
        seed: seed++,
        brightness: 0.28,
      });
    }
    // Tactile felt-marimba 8th-note documentary pulse + quiet dotted-8th stereo echo
    for (let e = 0; e < 8; e++) {
      const tNote = startSec + e * (beat * 0.5);
      const pan = e % 2 === 0 ? -0.24 : 0.24;
      const accent = e % 2 === 0 ? 0.14 : 0.095;
      renderMarimbaPluck(left, right, {
        startSec: tNote,
        freq: spec.arp[e],
        durSec: 0.55,
        gain: accent,
        pan,
        seed: seed++,
      });
      // Soft stereo echo 3/16th beat later on opposite side
      const echoAt = tNote + beat * 0.375;
      if (echoAt + 0.3 < sec) {
        renderMarimbaPluck(left, right, {
          startSec: echoAt,
          freq: spec.arp[e],
          durSec: 0.4,
          gain: accent * 0.38,
          pan: -pan * 1.2,
          seed: seed++,
        });
      }
    }
  }

  // Whisper-soft brushed air-shaker texture on 8th subdivisions (band-limited 4.8kHz silk, zero Nyquist fizz)
  const pinkL = createPinkNoise(2991);
  const pinkR = createPinkNoise(2992);
  const bpL = createSVF(), bpR = createSVF();
  const lpL = createSVF(), lpR = createSVF();
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const subBeat = (t % (beat * 0.5)) / (beat * 0.5);
    const brushEnv = Math.exp(-subBeat * 13.0) * Math.min(1, subBeat / 0.1);
    const sL = lpL(bpL(pinkL(), 4800, 1.8, 'bp'), 7200, 0.75, 'lp') * brushEnv * 0.022;
    const sR = lpR(bpR(pinkR(), 5100, 1.8, 'bp'), 7200, 0.75, 'lp') * brushEnv * 0.022;
    left[i] += sL;
    right[i] += sR;
  }

  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.34, room: 0.8, damp: 0.55 });
  return masterStereo(rL, rR, { targetPeak: 0.62, fadeIn: 0.25, fadeOut: 0.65, drive: 1.08 });
}

// 6. ui-click.wav — Tactile acoustic trackpad / studio switch micro-click
function buildUiClick() {
  const sec = 0.14;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const pinkL = createPinkNoise(3101);
  const pinkR = createPinkNoise(3102);
  const bpL = createSVF(), bpR = createSVF();

  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const atk = Math.min(1, t / 0.0008);
    const click = atk * Math.exp(-t * 165);
    const wood = atk * Math.exp(-t * 95) * Math.sin(TAU * 1120 * t) * 0.32;
    const rel = t > 0.038 ? Math.min(1, (t - 0.038) / 0.001) * Math.exp(-(t - 0.038) * 190) * 0.34 : 0;
    left[i] = bpL(pinkL(), 2450, 1.4, 'bp') * (click + rel) + wood;
    right[i] = bpR(pinkR(), 2580, 1.4, 'bp') * (click + rel) + wood;
  }
  return masterStereo(left, right, { targetPeak: 0.72, fadeIn: 0.0005, fadeOut: 0.02, drive: 1.1 });
}

// 7. card-pop.wav — Soft organic wooden/air pop
function buildCardPop() {
  const sec = 0.24;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const pink = createPinkNoise(3201);
  const bp = createSVF();
  let phase = 0;

  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 210 + 270 * (1 - Math.exp(-t * 42));
    phase += (TAU * freq) / RATE;
    const atk = 1 - Math.exp(-t / 0.0025);
    const body = atk * Math.exp(-t * 24) * Math.sin(phase);
    const puff = bp(pink(), 1150, 1.1, 'bp') * atk * Math.exp(-t * 65) * 0.35;
    left[i] = body * 0.78 + puff;
    right[i] = body * 0.78 + puff * 0.94;
  }
  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.14, room: 0.55, damp: 0.6 });
  return masterStereo(rL, rR, { targetPeak: 0.7, fadeIn: 0.002, fadeOut: 0.03, drive: 1.08 });
}

// 8. data-tick.wav — 5 delicate watch-escapement / wooden counter ticks
function buildDataTick() {
  const sec = 0.52;
  const n = Math.ceil(sec * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const pink = createPinkNoise(3301);
  const bp = createSVF();

  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let sL = 0, sR = 0;
    for (let k = 0; k < 5; k++) {
      const dt = t - k * 0.092;
      if (dt < 0 || dt > 0.05) continue;
      const env = Math.min(1, dt / 0.0008) * Math.exp(-dt * 125);
      const tone = Math.sin(TAU * (1480 + k * 110) * dt) * 0.45 + bp(pink(), 2600 + k * 140, 1.6, 'bp') * 0.75;
      const pan = -0.22 + k * 0.11;
      const angle = ((pan + 1) * Math.PI) / 4;
      sL += tone * env * Math.cos(angle);
      sR += tone * env * Math.sin(angle);
    }
    left[i] = sL;
    right[i] = sR;
  }
  const [rL, rR] = applyStereoReverb(left, right, { wet: 0.12, room: 0.5, damp: 0.65 });
  return masterStereo(rL, rR, { targetPeak: 0.68, fadeIn: 0.001, fadeOut: 0.04, drive: 1.05 });
}

function encodeStereoWav(left, right) {
  const samples = left.length;
  const wav = Buffer.alloc(44 + samples * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
  }
  return wav;
}

await mkdir(target, { recursive: true });

const cues = [
  ['glass-ident', buildGlassIdent],
  ['soft-impact', buildSoftImpact],
  ['slipstream', buildSlipstream],
  ['pulse-bed', buildPulseBed],
  ['ui-click', buildUiClick],
  ['card-pop', buildCardPop],
  ['data-tick', buildDataTick],
  ['warm-ambient', buildWarmAmbient],
];

for (const [name, builder] of cues) {
  const [l, r] = builder();
  const wav = encodeStereoWav(l, r);
  await writeFile(join(target, `${name}.wav`), wav);
  console.log(`Generated ${name}.wav (${(l.length / RATE).toFixed(2)}s, ${(wav.length / 1024).toFixed(0)} KB)`);
}
