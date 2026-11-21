// Masters for the bundled 48 kHz stereo cues. No samples or external instruments.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const target = fileURLToPath(new URL('../resources/public/studio/', import.meta.url));
const rate = 48000,
  tau = 2 * Math.PI;
const tone = (hz, t, phase = 0) => Math.sin(tau * hz * t + phase);
const attack = (t, length) => Math.min(1, Math.max(0, t / length)) ** 2;
const note = (t, at, hz, decay, pan) => {
  const a = t - at;
  if (a < 0) return 0;
  return (
    attack(a, 0.012) *
    Math.exp(-a * decay) *
    (tone(hz, a) +
      0.23 * tone(hz * 2.001, a, pan * 0.05) * Math.exp(-a * 3) +
      0.055 * tone(hz * 4.009, a) * Math.exp(-a * 7))
  );
};
const glass = (t, ch) =>
  0.42 * note(t, 0, 587.33, 3.6, ch) +
  0.3 * note(t, 0.12, 880, 3.3, ch) +
  0.14 * note(t, 0.245 + ch * 0.016, 1174.66, 4.2, ch);
const impact = (t, ch) =>
  attack(t, 0.004) *
    Math.exp(-t * 10) *
    (0.64 * Math.sin(tau * (48 * t + 0.84 * (1 - Math.exp(-t * 25)))) + 0.2 * tone(92.5, t)) +
  0.16 * note(t, 0.018 + ch * 0.002, 349.23, 24, ch);
const sweep = (t, ch) => {
  const s = Math.min(1, t / 0.84);
  const env = t < 0.84 ? s * s * Math.sin(s * Math.PI * 0.5) : Math.exp(-13 * (t - 0.84));
  let air = 0;
  for (let n = 1; n <= 11; n++)
    air += tone(137 * n + 3 * n * n, t * (0.62 + 0.56 * s), n * n + ch * n * 0.34) / Math.sqrt(n);
  return env * (air * 0.14 + 0.085 * tone(62, t)) + 0.19 * note(t, 0.84, 196, 10, ch);
};
const bed = (t, ch) => {
  const beat = 60 / 100,
    colors = [
      [146.832, 220, 261.626, 329.628],
      [130.813, 195.998, 246.942, 293.665],
      [164.814, 220, 261.626, 329.628],
      [146.832, 195.998, 246.942, 293.665],
    ];
  let sound = 0;
  for (let bar = 0; bar < 4; bar++) {
    const time = t - bar * 4 * beat;
    if (time < 0) break;
    const chord = colors[bar];
    const padEnv = attack(time, 0.22) * Math.exp(-Math.max(0, time - 1.65) * 2.6);
    for (let i = 0; i < 4; i++)
      sound +=
        padEnv * 0.043 * tone(chord[i] * (1 + ch * 0.0008), time, i * 0.93) * (0.94 + 0.06 * tone(0.3, time));
    for (let i = 0; i < 8; i++)
      sound +=
        0.12 * note(time, (i * beat) / 2, chord[[0, 2, 1, 3, 1, 2, 0, 3][i]] * (i % 3 === 0 ? 2 : 1), 6, ch);
    for (let i = 0; i < 4; i++)
      sound += 0.22 * impact(Math.max(0, time - i * beat), ch) * Number(time >= i * beat);
  }
  return sound;
};
const uiClick = (t, ch) => {
  const click1 = attack(t, 0.0012) * Math.exp(-t * 140) * (0.75 * tone(1850, t) + 0.45 * tone(3420, t, ch * 0.4));
  const release = t > 0.052 ? attack(t - 0.052, 0.0015) * Math.exp(-(t - 0.052) * 180) * 0.38 * tone(1320, t - 0.052) : 0;
  return click1 + release;
};
const cardPop = (t, ch) => {
  const f = 320 + 540 * (1 - Math.exp(-t * 38));
  return attack(t, 0.003) * Math.exp(-t * 22) * (0.72 * Math.sin(tau * f * t + ch * 0.15) + 0.18 * tone(980, t));
};
const dataTick = (t, ch) => {
  let out = 0;
  for (let k = 0; k < 5; k++) {
    const dt = t - k * 0.095;
    if (dt >= 0) out += attack(dt, 0.001) * Math.exp(-dt * 95) * (0.55 * tone(2100 + k * 140, dt, ch * 0.2));
  }
  return out;
};
const warmAmbient = (t, ch) => {
  const notes = [174.61, 220.0, 261.63, 349.23];
  const env = attack(t, 0.85) * (0.85 + 0.15 * Math.sin(tau * 0.12 * t + ch * 0.5));
  let s = 0;
  for (let i = 0; i < notes.length; i++) {
    s += 0.22 * tone(notes[i] * (1 + ch * 0.0012), t, i * 1.1) * (0.75 + 0.25 * Math.sin(tau * (0.08 + i * 0.03) * t));
  }
  return env * s;
};
await mkdir(target, { recursive: true });
for (const [filename, seconds, level, f] of [
  ['glass-ident', 1.75, 0.8, glass],
  ['soft-impact', 0.75, 0.79, impact],
  ['slipstream', 1.4, 0.76, sweep],
  ['pulse-bed', 10.8, 0.7, bed],
  ['ui-click', 0.22, 0.78, uiClick],
  ['card-pop', 0.32, 0.76, cardPop],
  ['data-tick', 0.58, 0.72, dataTick],
  ['warm-ambient', 10.0, 0.58, warmAmbient],
]) {
  const samples = Math.ceil(seconds * rate),
    pcm = new Float32Array(samples * 2);
  let peak = 0;
  for (let i = 0; i < samples; i++)
    for (let ch = 0; ch < 2; ch++) {
      const t = i / rate,
        v = f(t, ch) * Math.min(1, (seconds - t) / 0.1);
      pcm[i * 2 + ch] = v;
      peak = Math.max(peak, Math.abs(v));
    }
  const wav = Buffer.alloc(44 + samples * 4);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < pcm.length; i++)
    wav.writeInt16LE(Math.round((pcm[i] / peak) * level * 32767), 44 + i * 2);
  await writeFile(join(target, filename + '.wav'), wav);
}
