// Генератор фоновой музыки без авторских прав (синтез в браузере, OfflineAudioContext).
// Настроения: energetic, inspiring, cinematic, lofi, calm, tech.
export const MOODS = {
  energetic: { name: "Энергичная (поп/электро)", bpm: 124, minor: true, prog: [0, 5, 2, 6], drums: "four", arp: "16", cutoff: 2600, swing: 0 },
  inspiring: { name: "Вдохновляющая (корпоратив)", bpm: 108, minor: false, prog: [0, 4, 5, 3], drums: "pop", arp: "8", cutoff: 3000, swing: 0 },
  cinematic: { name: "Кинематографичная", bpm: 88, minor: true, prog: [0, 5, 3, 4], drums: "epic", arp: "8", cutoff: 1500, swing: 0 },
  lofi: { name: "Lo-fi / спокойный бит", bpm: 82, minor: false, prog: [1, 4, 0, 5], drums: "lofi", arp: "none", cutoff: 1300, swing: 0.12, seventh: true },
  calm: { name: "Спокойная (эмбиент)", bpm: 70, minor: false, prog: [0, 3, 5, 4], drums: "none", arp: "4", cutoff: 1800, swing: 0 },
  tech: { name: "Технологичная", bpm: 118, minor: true, prog: [0, 0, 5, 6], drums: "four", arp: "16", cutoff: 2200, swing: 0 },
};
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function noiseBuf(ctx, sec = 1) { const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate); const d = b.getChannelData(0); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; } return b; }
function impulse(ctx, sec = 2.8, decay = 3) { const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return b; }

export async function generateMusic(duration = 45, moodKey = "inspiring", seed = 1) {
  const m = MOODS[moodKey] || MOODS.inspiring;
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * (duration + 0.5)), sr);
  const master = ctx.createGain(); master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx); const verbG = ctx.createGain(); verbG.gain.value = moodKey === "cinematic" || moodKey === "calm" ? 0.45 : 0.25; verb.connect(verbG).connect(master);
  const noise = noiseBuf(ctx, 1);
  // общий фейд
  master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.8, 1.2);
  master.gain.setValueAtTime(0.8, Math.max(1.3, duration - 2.5)); master.gain.linearRampToValueAtTime(0, duration);

  const beat = 60 / m.bpm, bar = beat * 4, scale = m.minor ? MIN : MAJ;
  const root = (m.minor ? 57 : 60) + ((seed * 5) % 5) - 2; // A3/C4 ± немного
  const degree = (d, oct = 0) => root + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
  const chordOf = (d) => [degree(d), degree(d + 2), degree(d + 4), ...(m.seventh ? [degree(d + 6)] : [])];

  const pad = (notes, t, len) => {
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = m.cutoff; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + Math.min(0.5, len / 3)); g.gain.setValueAtTime(0.06, t + len - 0.25); g.gain.linearRampToValueAtTime(0, t + len + 0.4);
    f.connect(g); g.connect(master); g.connect(verb);
    for (const n of notes) for (const det of [-7, 7]) { const o = ctx.createOscillator(); o.type = moodKey === "lofi" ? "triangle" : "sawtooth"; o.frequency.value = hz(n); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + 0.5); }
  };
  const pluck = (n, t, vol = 0.07, type = "triangle", dec = 0.35) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(n);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3800;
    o.connect(f).connect(g); g.connect(master); g.connect(verb); o.start(t); o.stop(t + dec + 0.05);
  };
  const bass = (n, t, len) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz(n - 24);
    const o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = hz(n - 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.02); g.gain.setValueAtTime(0.32, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const g2 = ctx.createGain(); g2.gain.value = 0.12; o.connect(g); o2.connect(g2).connect(g); g.connect(master); o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
  };
  const kick = (t, v = 0.9) => { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13); const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); o.connect(g).connect(master); o.start(t); o.stop(t + 0.42); };
  const snare = (t, v = 0.35) => { const s = ctx.createBufferSource(); s.buffer = noise; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.7; const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); s.connect(f).connect(g); g.connect(master); g.connect(verb); s.start(t); s.stop(t + 0.22); const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 185; const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.6, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(g2).connect(master); o.start(t); o.stop(t + 0.12); };
  const hat = (t, v = 0.06, open = false) => { const s = ctx.createBufferSource(); s.buffer = noise; const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7500; const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.25 : 0.05)); s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + 0.3); };
  const tom = (t, v = 0.6) => { const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.35); const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); o.connect(g); g.connect(master); g.connect(verb); o.start(t); o.stop(t + 0.75); };

  const bars = Math.ceil(duration / bar) + 1;
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar; if (t0 > duration) break;
    const deg = m.prog[b % m.prog.length] + (m.minor ? 0 : 0);
    const ch = chordOf(deg);
    pad(ch, t0, bar);
    const intro = b < 1, build = b % 8 === 7;
    // бас
    if (!intro || moodKey === "calm") {
      const step = m.drums === "four" ? beat / 2 : beat;
      for (let t = 0; t < bar - 0.01; t += step) bass(ch[0], t0 + t, step * 0.9);
    }
    // арпеджио
    const arpStep = m.arp === "16" ? beat / 4 : m.arp === "8" ? beat / 2 : m.arp === "4" ? beat : 0;
    if (arpStep) { const tones = [...ch.map((n) => n + 12), ch[1] + 24]; let k = 0; for (let t = 0; t < bar - 0.01; t += arpStep) pluck(tones[(k++ * (b % 2 ? 3 : 1)) % tones.length], t0 + t, moodKey === "calm" ? 0.05 : 0.045, moodKey === "tech" ? "square" : "triangle", moodKey === "calm" ? 0.9 : 0.3); }
    if (moodKey === "lofi") for (let i = 0; i < 4; i++) pluck(ch[i % ch.length] + 12, t0 + i * beat + 0.02, 0.05, "sine", 0.9);
    // ударные
    if (intro && m.drums !== "epic") continue;
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * beat, sw = (k) => (k % 2 ? m.swing * beat : 0);
      if (m.drums === "four") { kick(t); hat(t + beat / 2, 0.07, true); if (i % 2) snare(t, 0.3); if (build && i === 3) for (let r = 0; r < 4; r++) snare(t + r * beat / 4, 0.12 + r * 0.05); }
      else if (m.drums === "pop") { if (i === 0 || i === 2) kick(t); if (i === 2 && b % 2) kick(t + beat / 2, 0.6); if (i % 2) snare(t, 0.3); hat(t, 0.05); hat(t + beat / 2, 0.04); }
      else if (m.drums === "lofi") { if (i === 0) kick(t, 0.7); if (i === 2) kick(t + beat / 2, 0.55); if (i % 2) snare(t, 0.2); hat(t + sw(0), 0.035); hat(t + beat / 2 + m.swing * beat, 0.03); }
      else if (m.drums === "epic") { if (i === 0) tom(t, b % 4 === 3 ? 0.9 : 0.6); if (i === 2 && b % 2) tom(t, 0.5); if (b > 3 && i === 3) snare(t, 0.18); }
    }
  }
  // лёгкий «винил» для lo-fi
  if (moodKey === "lofi") { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3000; const g = ctx.createGain(); g.gain.value = 0.012; s.connect(f).connect(g).connect(master); s.start(0); s.stop(duration); }
  return await ctx.startRendering();
}

export function wavBlob(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length, out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); out.setUint32(4, 36 + len * ch * 2, true); w(8, "WAVE"); w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, len * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out], { type: "audio/wav" });
}
