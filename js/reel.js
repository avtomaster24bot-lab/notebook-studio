// Завод рилсов: сценарий (LLM) → картинки (ИИ/сток) → озвучка (Microsoft Neural) → музыка → субтитры → MP4 (WebCodecs).
import { llmJSON, tts, genImage, stock, fetchBlob, settings, health } from "./api.js";
import { generateMusic, MOODS } from "./music.js";

const W = 1080, H = 1920, FPS = 30;

export async function makeScript({ topic, context = "", duration = 45, tone = "экспертно и живо", lang = "ru" }) {
  const words = Math.round(duration * 2.35), scenes = Math.max(5, Math.min(10, Math.round(duration / 6)));
  const sys = `Ты — сильный сценарист вирусных вертикальных видео (Reels, Shorts, TikTok) и арт-директор. Пишешь по-русски, живо, конкретно, без воды и канцелярита. Факты — только достоверные; если есть материалы пользователя, опирайся на них. Отвечай ТОЛЬКО JSON-объектом.`;
  const user = `Тема ролика: «${topic}».
Длительность: ~${duration} секунд, всего около ${words} слов озвучки, ${scenes} сцен. Тон: ${tone}.
${context ? `Материалы (используй факты отсюда):\n"""\n${context.slice(0, 9000)}\n"""\n` : ""}
Правила:
- Сцена 1 — хук: сильная первая фраза (вопрос, интрига или неожиданный факт), до 12 слов.
- Каждая следующая сцена — один конкретный пункт/мысль, 1–2 коротких предложения, разговорный язык.
- Последняя сцена — вывод и призыв (подписаться/сохранить/написать в комментариях).
- Числа пиши словами, если они произносятся («пять», а не «5»). Без эмодзи и хэштегов в озвучке. Грамотный, естественный русский язык — перечитай каждую фразу.
- image_prompt — подробный промпт на АНГЛИЙСКОМ для фотореалистичной вертикальной картинки к этой сцене: объект, окружение, свет, ракурс, стиль (например "cinematic photo, 35mm, shallow depth of field"). Без текста на картинке.
- stock_query — 2–4 английских слова для поиска стокового фото.
- label — подпись на экран для сцены, 1–4 слова (для сцен-пунктов начинай с номера: «01 Скрип»).
Формат JSON:
{"title":"название ролика","hook":"заголовок на экран, до 7 слов","scenes":[{"voice":"текст озвучки","label":"подпись","image_prompt":"...","stock_query":"..."}],"caption":"текст поста под видео, 2–4 предложения","hashtags":["#тег1","#тег2","#тег3","#тег4","#тег5"],"music":"energetic|inspiring|cinematic|lofi|calm|tech"}`;
  const { data, provider } = await llmJSON([{ role: "system", content: sys }, { role: "user", content: user }], { temperature: 0.7, max_tokens: 2800 });
  const sc = (data.scenes || []).filter((s) => s && String(s.voice || "").trim()).map((s) => ({
    voice: String(s.voice).replace(/[#*_]/g, "").trim(), label: String(s.label || "").slice(0, 40),
    image_prompt: String(s.image_prompt || s.voice), stock_query: String(s.stock_query || topic),
  }));
  if (sc.length < 2) throw new Error("Модель не написала сцены — попробуйте ещё раз");
  // Редактура: второй проход исправляет корявые фразы и ошибки в озвучке.
  try {
    const ed = await llmJSON([{ role: "system", content: "Ты — строгий литературный редактор русского языка. Отвечай только JSON." }, { role: "user", content: `Исправь в репликах озвучки рилса грамматические, смысловые и стилистические ошибки, сделай фразы естественными для устной речи. Не меняй смысл, факты, порядок и примерную длину. Числа — словами. Верни {"lines":["..."]} ровно из ${sc.length} строк.\n${JSON.stringify(sc.map((x) => x.voice))}` }], { temperature: 0.2, max_tokens: 1800 }, 1);
    const lines = ed.data.lines;
    if (Array.isArray(lines) && lines.length === sc.length) lines.forEach((l, i) => { const t = String(l || "").trim(); if (t.length > sc[i].voice.length * 0.5 && t.length < sc[i].voice.length * 1.6) sc[i].voice = t; });
  } catch (e) { console.warn("редактура пропущена", e); }
  return { title: data.title || topic, hook: String(data.hook || topic).slice(0, 70), scenes: sc, caption: data.caption || "", hashtags: data.hashtags || [], music: MOODS[data.music] ? data.music : "inspiring", provider };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const STYLE = ", vertical 9:16 composition, photorealistic, cinematic lighting, high detail, sharp focus, professional photography, no text, no watermark, no logo";
async function loadBitmap(blob) { return await createImageBitmap(blob); }

export async function sceneImage(scene, mode, used = new Set(), log = () => {}) {
  const tryAI = async () => { const r = await genImage(scene.image_prompt + STYLE, { width: 1080, height: 1920 }); return { blob: r.blob, credit: r.provider, provider: r.provider }; };
  const tryStock = async () => {
    const res = (await stock(scene.stock_query)).filter((x) => !used.has(x.url));
    for (const x of res.slice(0, 4)) { try { const b = await fetchBlob(x.url); used.add(x.url); return { blob: b, credit: `${x.author ? x.author + ", " : ""}${x.license} (${x.provider})`, provider: x.provider, source: x.source }; } catch { /* next */ } }
    throw new Error("сток: ничего не нашлось");
  };
  const order = mode === "stock" ? [tryStock, tryAI] : [tryAI, tryStock];
  for (const f of order) { try { return await f(); } catch (e) { log(`  картинка: ${e.message}`); } }
  return null;
}

// Оценка таймингов слов, если сервис озвучки их не вернул (запасной Google TTS).
function estimateWords(text, dur) {
  const ws = text.split(/\s+/).filter(Boolean); const total = ws.reduce((a, w) => a + w.length + 2, 0); let t = 0.05;
  return ws.map((w) => { const d = (dur - 0.1) * (w.length + 2) / total; const r = { text: w, start: t, end: t + d * 0.92 }; t += d; return r; });
}
// Привязываем пунктуацию из исходного текста к словам (Edge отдаёт слова без неё).
function attachPunct(words, text) {
  let pos = 0;
  return words.map((w) => { const i = text.indexOf(w.text, pos); if (i < 0) return w; let j = i + w.text.length; while (j < text.length && /[.,!?…:;»"]/.test(text[j])) j++; pos = j; return { ...w, text: text.slice(i, j) }; });
}

export async function buildAssets(script, { mode = "ai", musicMood, musicFile, voice = settings.voiceA, log = () => {}, progress = () => {} }) {
  const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  log("Озвучка (Microsoft Neural)…");
  let done = 0; const totalSteps = script.scenes.length * 2 + 1;
  const voices = await pool(script.scenes, 3, async (s, i) => {
    const r = await tts(s.voice, voice);
    const buf = await ac.decodeAudioData(await r.blob.arrayBuffer());
    progress(++done / totalSteps);
    log(`  сцена ${i + 1}: ${buf.duration.toFixed(1)} с · ${r.provider}`);
    return { buf, words: r.words.length ? attachPunct(r.words, s.voice) : estimateWords(s.voice, buf.duration), provider: r.provider };
  });
  log(mode === "stock" ? "Подбор стоковых фото…" : "Генерация картинок ИИ…");
  const used = new Set();
  const free = !(settings.agnesKey || settings.pollinationsKey || (health && health.image !== "pollinations-flux"));
  const imgs = await pool(script.scenes, mode === "ai" && free ? 1 : 3, async (s, i) => {
    const r = await sceneImage(s, mode, used, log);
    progress(++done / totalSteps);
    log(`  картинка ${i + 1}: ${r ? r.provider : "нет — будет градиент"}`);
    return r ? { bmp: await loadBitmap(r.blob), blob: r.blob, credit: r.credit, provider: r.provider } : null;
  });
  // таймлайн
  const GAP = 0.18, LEAD = 0.25; let t = LEAD;
  const scenes = script.scenes.map((s, i) => {
    const v = voices[i]; const start = t; t += v.buf.duration + GAP;
    return { ...s, start, end: t, voiceBuf: v.buf, words: v.words.map((w) => ({ ...w, start: w.start + start, end: w.end + start })), img: imgs[i] };
  });
  const total = t + 0.9;
  for (let i = 0; i < scenes.length; i++) scenes[i].vEnd = i < scenes.length - 1 ? scenes[i + 1].start : total;
  log("Музыка…");
  let music;
  if (musicFile) { music = await ac.decodeAudioData(await musicFile.arrayBuffer()); log("  своя музыка: " + musicFile.name); }
  else { const mood = musicMood || script.music; music = await generateMusic(total, mood, script.title.length); log(`  синтез «${MOODS[mood].name}» (без авторских прав)`); }
  progress(1);
  // сведение
  const off = new OfflineAudioContext(2, Math.ceil(48000 * total), 48000);
  const mg = off.createGain(); mg.gain.value = 0.17; mg.gain.setValueAtTime(0.17, Math.max(0, total - 1.6)); mg.gain.linearRampToValueAtTime(0, total);
  const ms = off.createBufferSource(); ms.buffer = music; ms.loop = !!musicFile; ms.connect(mg).connect(off.destination); ms.start(0);
  const comp = off.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 2.5; comp.connect(off.destination);
  for (const s of scenes) { const src = off.createBufferSource(); src.buffer = s.voiceBuf; const g = off.createGain(); g.gain.value = 1.15; src.connect(g).connect(comp); src.start(s.start); }
  const mix = await off.startRendering();
  ac.close();
  return { scenes, total, mix, hook: script.hook, title: script.title, credits: [...new Set(imgs.filter(Boolean).map((x) => x.credit))], voiceProvider: voices[0]?.provider };
}

// ---------- рисование кадра ----------
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
function groupWords(words) {
  const groups = []; let g = [];
  for (const w of words) {
    const len = g.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    if (g.length && (g.length >= 3 || len > 20 || /[.!?…]$/.test(g[g.length - 1].text))) { groups.push(g); g = []; }
    g.push(w);
  }
  if (g.length) groups.push(g);
  return groups.map((g, i, a) => ({ words: g, start: g[0].start, end: a[i + 1] ? a[i + 1][0].start : g[g.length - 1].end + 0.4 }));
}

export function makeRenderer(A) {
  const accent = settings.accent || "#19e3b1";
  for (const s of A.scenes) s.groups = groupWords(s.words);
  return function draw(ctx, t) {
    ctx.fillStyle = "#07090c"; ctx.fillRect(0, 0, W, H);
    let si = A.scenes.findIndex((s) => t < s.vEnd); if (si < 0) si = A.scenes.length - 1;
    const drawImg = (s, k, alpha) => {
      const p = Math.min(1, Math.max(0, (t - s.start + 0.4) / (s.vEnd - s.start + 0.8)));
      ctx.globalAlpha = alpha;
      if (!s.img) { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#14303a"); g.addColorStop(1, "#2a1f5c"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; return; }
      const b = s.img.bmp; const zoomIn = k % 2 === 0; const z = zoomIn ? 1.04 + 0.12 * ease(p) : 1.16 - 0.12 * ease(p);
      const sc = Math.max(W / b.width, H / b.height) * z; const dw = b.width * sc, dh = b.height * sc;
      const dir = [[-1, 0], [1, -1], [0, 1], [1, 1]][k % 4]; const pan = 36 * (p - 0.5);
      ctx.drawImage(b, (W - dw) / 2 + dir[0] * pan, (H - dh) / 2 + dir[1] * pan, dw, dh);
      ctx.globalAlpha = 1;
    };
    const cur = A.scenes[si];
    const fade = 0.35;
    if (si > 0 && t - cur.start < fade) { drawImg(A.scenes[si - 1], si - 1, 1); drawImg(cur, si, ease((t - cur.start) / fade)); }
    else drawImg(cur, si, 1);
    // затемнение сверху и снизу
    let g = ctx.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, "rgba(0,0,0,.72)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 640);
    g = ctx.createLinearGradient(0, 1000, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(.55, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,.85)"); ctx.fillStyle = g; ctx.fillRect(0, 1000, W, H - 1000);
    // прогресс
    ctx.fillStyle = "rgba(255,255,255,.18)"; rr(ctx, 60, 70, W - 120, 10, 5); ctx.fill();
    ctx.fillStyle = accent; rr(ctx, 60, 70, Math.max(10, (W - 120) * Math.min(1, t / A.total)), 10, 5); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // хук (первая сцена)
    const s0 = A.scenes[0];
    if (t < s0.vEnd) {
      const a = ease((t - 0.05) / 0.35); const out = t > s0.vEnd - 0.3 ? ease((s0.vEnd - t) / 0.3) : 1;
      ctx.save(); ctx.globalAlpha = Math.min(a, out); ctx.translate(W / 2, 330); ctx.scale(0.85 + 0.15 * a, 0.85 + 0.15 * a);
      ctx.font = "900 74px Unbounded, Montserrat, sans-serif"; const lines = wrap(ctx, A.hook.toUpperCase(), 900);
      const lh = 92, bh = lines.length * lh + 60; ctx.fillStyle = "rgba(10,12,16,.82)"; rr(ctx, -500, -bh / 2, 1000, bh, 34); ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.stroke();
      lines.forEach((l, i) => { ctx.fillStyle = i === lines.length - 1 ? accent : "#fff"; ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh + 4); });
      ctx.restore();
    } else if (cur.label) {
      // подпись сцены
      const a = ease((t - cur.start) / 0.3);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2 + (1 - a) * -60, 250);
      ctx.font = "800 58px Montserrat, sans-serif"; const m = cur.label.toUpperCase(); const mw = Math.min(980, ctx.measureText(m).width + 80);
      ctx.fillStyle = accent; rr(ctx, -mw / 2, -50, mw, 100, 50); ctx.fill(); ctx.fillStyle = "#06120e"; ctx.fillText(m, 0, 3, 940); ctx.restore();
    }
    // субтитры
    const grp = cur.groups.find((gg) => t >= gg.start - 0.05 && t < gg.end) || null;
    if (grp) {
      const pop = ease((t - grp.start) / 0.14); const scl = 1.1 - 0.1 * pop;
      ctx.save(); ctx.translate(W / 2, 1420); ctx.scale(scl, scl);
      ctx.font = "900 92px Montserrat, sans-serif";
      const words = grp.words.map((w) => w.text.toUpperCase());
      const lines = []; let line = [], lw = 0; const space = ctx.measureText(" ").width;
      words.forEach((w, i) => { const ww = ctx.measureText(w).width; if (line.length && lw + space + ww > 940) { lines.push(line); line = []; lw = 0; } line.push(i); lw += (line.length > 1 ? space : 0) + ww; });
      if (line.length) lines.push(line);
      const lh = 112;
      lines.forEach((ln, li) => {
        const widths = ln.map((i) => ctx.measureText(words[i]).width); const total = widths.reduce((a, b) => a + b, 0) + space * (ln.length - 1);
        let x = -total / 2; const y = (li - (lines.length - 1) / 2) * lh;
        ln.forEach((i, k) => {
          const w = grp.words[i]; const active = t >= w.start - 0.03 && t < (grp.words[i + 1]?.start ?? grp.end);
          ctx.textAlign = "left"; ctx.lineJoin = "round"; ctx.lineWidth = 16; ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.strokeText(words[i], x, y);
          ctx.fillStyle = active ? accent : "#fff"; ctx.fillText(words[i], x, y); x += widths[k] + space;
        });
      });
      ctx.restore();
    }
    // подпись автора
    if (settings.handle) { ctx.font = "700 40px Montserrat, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillText(settings.handle, W / 2, H - 110); }
    // финальный призыв
    if (t > A.total - 2.6) {
      const a = ease((t - (A.total - 2.6)) / 0.35);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, 1720); ctx.font = "800 50px Montserrat, sans-serif"; const m = "СОХРАНИ И ПОДПИШИСЬ"; const mw = ctx.measureText(m).width + 90;
      ctx.fillStyle = "rgba(255,255,255,.95)"; rr(ctx, -mw / 2, -46, mw, 92, 46); ctx.fill(); ctx.fillStyle = "#0b0d11"; ctx.textAlign = "center"; ctx.fillText(m, 0, 3); ctx.restore();
    }
  };
}

// ---------- кодирование MP4 ----------
export async function renderMP4(A, { onProgress = () => {}, canvas } = {}) {
  await Promise.all(["900 74px Unbounded", "900 92px Montserrat", "800 58px Montserrat"].map((f) => document.fonts.load(f, "АБВ ABC")));
  if (!("VideoEncoder" in window)) return await renderRealtime(A, { onProgress, canvas });
  const { Muxer, ArrayBufferTarget } = await import("https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm");
  canvas = canvas || document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false });
  const draw = makeRenderer(A);
  // подбираем кодеки
  let vcfg = null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42003e", "avc1.640033"]) for (const hw of ["no-preference", "prefer-software"]) {
    if (vcfg) break; const c = { codec, width: W, height: H, bitrate: 6_000_000, framerate: FPS, hardwareAcceleration: hw, avc: { format: "avc" } };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) vcfg = c; } catch { /* next */ }
  }
  if (!vcfg) return await renderRealtime(A, { onProgress, canvas });
  let acfg = null, acodec = null;
  for (const [codec, mux] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) { const c = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }; try { if ((await AudioEncoder.isConfigSupported(c)).supported) { acfg = c; acodec = mux; break; } } catch { /**/ } }
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: FPS }, ...(acfg ? { audio: { codec: acodec, numberOfChannels: 2, sampleRate: 48000 } } : {}), fastStart: "in-memory", firstTimestampBehavior: "offset" });
  let encErr = null;
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encErr = e) });
  ve.configure(vcfg);
  if (acfg) {
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encErr = e) });
    ae.configure(acfg);
    const L = A.mix.getChannelData(0), R = A.mix.getChannelData(1), step = 4800;
    for (let i = 0; i < A.mix.length; i += step) {
      const n = Math.min(step, A.mix.length - i); const data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data });
      ae.encode(ad); ad.close();
    }
    await ae.flush(); ae.close();
  }
  const frames = Math.ceil(A.total * FPS);
  for (let i = 0; i < frames; i++) {
    if (encErr) throw encErr;
    draw(ctx, i / FPS);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    ve.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
    while (ve.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (i % 15 === 0) { onProgress(i / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await ve.flush(); ve.close(); muxer.finalize();
  if (encErr) throw encErr;
  onProgress(1);
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4", audio: acodec || "нет", video: vcfg.codec };
}

// Запасной путь для браузеров без WebCodecs: запись в реальном времени (WebM/MP4 через MediaRecorder).
async function renderRealtime(A, { onProgress, canvas }) {
  canvas = canvas || document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); const draw = makeRenderer(A);
  const ac = new AudioContext({ sampleRate: 48000 }); const dest = ac.createMediaStreamDestination(); const src = ac.createBufferSource(); src.buffer = A.mix; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ["video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }); const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(500); const t0 = ac.currentTime + 0.1; src.start(t0);
  await new Promise((res) => { const loop = () => { const t = ac.currentTime - t0; draw(ctx, Math.max(0, t)); onProgress(t / A.total); if (t >= A.total) return res(); requestAnimationFrame(loop); }; loop(); });
  rec.stop(); await done; ac.close();
  return { blob: new Blob(parts, { type: mime }), ext: mime.includes("mp4") ? "mp4" : "webm", audio: "realtime", video: mime };
}
