// Notebook Studio — серверная часть (Supabase Edge Function).
// Ключи живут только здесь (секреты функции), в браузер не попадают.
//   AGNES_API_KEY      — Agnes AI (текст agnes-2.5-flash, картинки agnes-image-2.1-flash) — как в «контент-заводе»
//   POLLINATIONS_API_KEY — Pollinations (лучшие модели, большие картинки) — необязательно
//   PEXELS_API_KEY / PIXABAY_API_KEY — сток-фото — необязательно (без них: Wikimedia Commons)
//   ALLOWED_ORIGINS    — доп. разрешённые сайты через запятую
import { secMsGec, SEC_MS_GEC_VERSION, TOKEN } from "./drm.js";
import { RawWs } from "./ws.ts";

const env = (k: string, d = "") => (Deno.env.get(k) ?? d).trim();
const AGNES_URL = "https://apihub.agnes-ai.com/v1/chat/completions";
const AGNES_IMG_URL = "https://apihub.agnes-ai.com/v1/images/generations";
const AGNES_MODEL = env("AGNES_MODEL", "agnes-2.5-flash");
const AGNES_IMG_MODEL = env("AGNES_IMAGE_MODEL", "agnes-image-2.1-flash");

const ORIGINS = ["https://avtomaster24bot-lab.github.io", ...env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean)];
function originOk(o: string | null) {
  if (!o) return false;
  if (ORIGINS.includes(o)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}
function cors(o: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": originOk(o) ? o! : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization,apikey,x-client-info,x-agnes-key,x-pollinations-key,x-pexels-key",
    "Access-Control-Expose-Headers": "x-provider,x-credit",
    "Vary": "Origin",
  };
}
const json = (o: string | null, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors(o), "Content-Type": "application/json; charset=utf-8" } });

// --- простой лимит запросов на IP (в пределах инстанса) ---
const hits = new Map<string, number[]>();
function limited(ip: string, max = 90) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

// ================= LLM =================
type Msg = { role: string; content: string };
async function llm(messages: Msg[], opts: { temperature?: number; max_tokens?: number; json?: boolean }, userKeys: Record<string, string>) {
  const agnesKey = userKeys.agnes || env("AGNES_API_KEY");
  const errors: string[] = [];
  if (agnesKey) {
    try {
      const r = await fetch(AGNES_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${agnesKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: AGNES_MODEL, messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.max_tokens ?? 2500, stream: false }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) throw new Error("agnes http " + r.status);
      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content;
      if (text && String(text).trim()) return { text: String(text), provider: `Agnes AI (${AGNES_MODEL})` };
      throw new Error("agnes empty");
    } catch (e) { errors.push(String(e)); }
  }
  const pk = userKeys.pollinations || env("POLLINATIONS_API_KEY");
  // Pollinations: с ключом — сильная модель, без ключа — бесплатная openai-fast
  const attempts = pk
    ? [{ url: "https://gen.pollinations.ai/v1/chat/completions", model: env("POLLINATIONS_MODEL", "openai-large"), key: pk }, { url: "https://text.pollinations.ai/openai", model: "openai-fast", key: "" }]
    : [{ url: "https://text.pollinations.ai/openai", model: "openai-fast", key: "" }];
  for (let i = 0; i < 3; i++) {
    for (const a of attempts) {
      try {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (a.key) h.Authorization = `Bearer ${a.key}`;
        const r = await fetch(a.url, {
          method: "POST", headers: h,
          body: JSON.stringify({ model: a.model, messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.max_tokens ?? 2500, seed: Math.floor(Math.random() * 1e6), ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
          signal: AbortSignal.timeout(100_000),
        });
        if (!r.ok) throw new Error(`pollinations ${a.model} http ${r.status}`);
        const d = await r.json();
        const text = d?.choices?.[0]?.message?.content;
        if (text && String(text).trim()) return { text: String(text), provider: `Pollinations (${d.model || a.model})` };
        throw new Error("pollinations empty");
      } catch (e) { errors.push(String(e)); }
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("Все текстовые модели недоступны: " + errors.slice(-3).join("; "));
}

// ================= IMAGES =================
function b64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function image(prompt: string, w: number, h: number, seed: number, userKeys: Record<string, string>) {
  const agnesKey = userKeys.agnes || env("AGNES_API_KEY");
  const errors: string[] = [];
  if (agnesKey) {
    try {
      const size = h > w ? "1024x1792" : w > h ? "1792x1024" : "1024x1024";
      const r = await fetch(AGNES_IMG_URL, {
        method: "POST", headers: { Authorization: `Bearer ${agnesKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: AGNES_IMG_MODEL, prompt, n: 1, size }), signal: AbortSignal.timeout(150_000),
      });
      if (!r.ok) throw new Error("agnes image http " + r.status);
      const d = await r.json(); const it = d?.data?.[0];
      if (it?.b64_json) return { mime: "image/png", data: it.b64_json, provider: "Agnes Image" };
      if (it?.url) { const x = await fetch(it.url); if (x.ok) return { mime: x.headers.get("content-type") || "image/jpeg", data: b64(await x.arrayBuffer()), provider: "Agnes Image" }; }
      throw new Error("agnes image empty");
    } catch (e) { errors.push(String(e)); }
  }
  const pk = userKeys.pollinations || env("POLLINATIONS_API_KEY");
  const q = `width=${w}&height=${h}&seed=${seed}&nologo=true&enhance=true&model=${pk ? env("POLLINATIONS_IMAGE_MODEL", "flux") : "flux"}`;
  const urls = pk
    ? [`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${q}`, `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`]
    : [`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`];
  for (let i = 0; i < 4; i++) {
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: pk && u.includes("gen.") ? { Authorization: `Bearer ${pk}` } : {}, signal: AbortSignal.timeout(120_000) });
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.startsWith("image/")) throw new Error(`pollinations image http ${r.status}`);
        return { mime: ct, data: b64(await r.arrayBuffer()), provider: "Pollinations FLUX" };
      } catch (e) { errors.push(String(e)); }
    }
    await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
  }
  throw new Error("Генерация картинки не удалась: " + errors.slice(-2).join("; "));
}

// ================= STOCK =================
async function stock(q: string, orientation: string, userKeys: Record<string, string>) {
  const out: Record<string, unknown>[] = [];
  const pexels = userKeys.pexels || env("PEXELS_API_KEY");
  if (pexels) {
    try {
      const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=12&orientation=${orientation}`, { headers: { Authorization: pexels } });
      const d = await r.json();
      for (const p of d.photos || []) out.push({ url: p.src.large2x || p.src.original, thumb: p.src.medium, author: p.photographer, license: "Pexels License", source: p.url, provider: "Pexels" });
    } catch (_) { /* ignore */ }
  }
  const pixabay = env("PIXABAY_API_KEY");
  if (pixabay && out.length < 6) {
    try {
      const r = await fetch(`https://pixabay.com/api/?key=${pixabay}&q=${encodeURIComponent(q)}&image_type=photo&orientation=${orientation === "portrait" ? "vertical" : "horizontal"}&per_page=12&safesearch=true`);
      const d = await r.json();
      for (const p of d.hits || []) out.push({ url: p.largeImageURL, thumb: p.webformatURL, author: p.user, license: "Pixabay License", source: p.pageURL, provider: "Pixabay" });
    } catch (_) { /* ignore */ }
  }
  if (out.length < 6) {
    try {
      const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q + " filetype:bitmap")}&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1600`;
      const r = await fetch(api, { headers: { "User-Agent": "NotebookStudio/1.0 (github.com/avtomaster24bot-lab/notebook-studio)" } });
      const d = await r.json();
      const pages = Object.values(d?.query?.pages || {}) as Record<string, any>[];
      pages.sort((a, b) => (a.index || 0) - (b.index || 0));
      for (const p of pages) {
        const ii = p.imageinfo?.[0]; if (!ii) continue;
        const lic = ii.extmetadata?.LicenseShortName?.value || "";
        if (!/cc0|public domain|cc by|pd/i.test(lic)) continue;
        if ((ii.width || 0) < 800) continue;
        const author = String(ii.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim();
        out.push({ url: ii.thumburl || ii.url, thumb: ii.thumburl || ii.url, author, license: lic, source: ii.descriptionurl, provider: "Wikimedia Commons" });
      }
    } catch (_) { /* ignore */ }
  }
  return out;
}

// ================= TTS: Microsoft Edge neural voices (+ Google fallback) =================
const EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const uid = () => crypto.randomUUID().replace(/-/g, "");
const tsStr = () => new Date().toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.*) GMT$/, "$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)");

async function edgeTTS(text: string, voice: string, rate: string, pitch: string): Promise<{ audio: Uint8Array; words: { text: string; start: number; end: number }[] }> {
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${uid()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const ws = await RawWs.connect(url, { "User-Agent": EDGE_UA, Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold", Cookie: `muid=${uid().toUpperCase()};`, Pragma: "no-cache", "Cache-Control": "no-cache", "Accept-Language": "en-US,en;q=0.9" });
  const chunks: Uint8Array[] = []; const words: { text: string; start: number; end: number }[] = [];
  const deadline = Date.now() + 60_000;
  try {
    const ts = tsStr();
    await ws.sendText(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${esc(text)}</prosody></voice></speak>`;
    await ws.sendText(`X-RequestId:${uid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    while (Date.now() < deadline) {
      const m = await ws.recv();
      if (!m) break;
      if (m.text !== undefined) {
        const s = m.text;
        if (s.includes("Path:audio.metadata")) {
          try {
            const body = JSON.parse(s.slice(s.indexOf("\r\n\r\n") + 4));
            for (const md of body.Metadata || []) if (md.Type === "WordBoundary") {
              const st = md.Data.Offset / 1e7, du = md.Data.Duration / 1e7;
              words.push({ text: md.Data.text.Text, start: +st.toFixed(3), end: +(st + du).toFixed(3) });
            }
          } catch (_) { /**/ }
        } else if (s.includes("Path:turn.end")) break;
      } else if (m.binary) {
        const buf = m.binary; const hl = (buf[0] << 8) | buf[1];
        const head = new TextDecoder().decode(buf.subarray(2, 2 + hl));
        if (head.includes("Path:audio") && buf.length > 2 + hl) chunks.push(buf.subarray(2 + hl));
      }
    }
  } finally { ws.close(); }
  const len = chunks.reduce((a, c) => a + c.length, 0);
  if (!len) throw new Error("edge tts: no audio");
  const all = new Uint8Array(len); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return { audio: all, words };
}
async function googleTTS(text: string, lang = "ru") {
  const parts: string[] = []; let cur = "";
  for (const w of text.split(/\s+/)) { if ((cur + " " + w).length > 190) { parts.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
  if (cur) parts.push(cur);
  const bufs: Uint8Array[] = [];
  for (const p of parts) {
    const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(p)}`, { headers: { "User-Agent": EDGE_UA, Referer: "https://translate.google.com/" } });
    if (!r.ok) throw new Error("google tts http " + r.status);
    bufs.push(new Uint8Array(await r.arrayBuffer()));
  }
  const len = bufs.reduce((a, c) => a + c.length, 0); const all = new Uint8Array(len); let o = 0; for (const c of bufs) { all.set(c, o); o += c.length; }
  return all;
}

// ================= PROXY (источники-ссылки, сток-картинки) =================
function safeUrl(u: string) {
  let url: URL; try { url = new URL(u); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const h = url.hostname;
  if (/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1|metadata)/i.test(h) || h.endsWith(".internal") || h.endsWith(".local")) return null;
  return url;
}

Deno.serve(async (req) => {
  const o = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(o) });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/notebook-studio/, "") || "/";
  if (path === "/" || path === "/health") {
    return json(o, { ok: true, service: "notebook-studio", text: env("AGNES_API_KEY") ? "agnes" : env("POLLINATIONS_API_KEY") ? "pollinations-key" : "pollinations-free", image: env("AGNES_API_KEY") ? "agnes" : "pollinations-flux", tts: "edge-neural", stock: env("PEXELS_API_KEY") ? "pexels" : env("PIXABAY_API_KEY") ? "pixabay" : "wikimedia" });
  }
  if (!originOk(o)) return json(o, { error: "origin not allowed" }, 403);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "?";
  if (limited(ip)) return json(o, { error: "Слишком много запросов, подождите минуту" }, 429);
  const userKeys = { agnes: req.headers.get("x-agnes-key") || "", pollinations: req.headers.get("x-pollinations-key") || "", pexels: req.headers.get("x-pexels-key") || "" };
  try {
    if (path === "/llm" && req.method === "POST") {
      const b = await req.json();
      const msgs = (b.messages || []).slice(-40).map((m: Msg) => ({ role: m.role, content: String(m.content).slice(0, 60_000) }));
      return json(o, await llm(msgs, { temperature: b.temperature, max_tokens: Math.min(b.max_tokens || 2500, 6000), json: !!b.json }, userKeys));
    }
    if (path === "/image" && req.method === "POST") {
      const b = await req.json();
      const w = Math.min(Math.max(+b.width || 1080, 256), 2048), h = Math.min(Math.max(+b.height || 1920, 256), 2048);
      return json(o, await image(String(b.prompt || "").slice(0, 1500), w, h, +b.seed || Math.floor(Math.random() * 1e9), userKeys));
    }
    if (path === "/stock") {
      return json(o, { results: await stock(url.searchParams.get("q") || "", url.searchParams.get("orientation") || "portrait", userKeys) });
    }
    if (path === "/tts" && req.method === "POST") {
      const b = await req.json();
      const text = String(b.text || "").slice(0, 4000).trim();
      if (!text) return json(o, { error: "empty text" }, 400);
      const voice = /^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(b.voice || "") ? b.voice : "ru-RU-SvetlanaNeural";
      const rate = /^[+-]\d{1,2}%$/.test(b.rate || "") ? b.rate : "+0%";
      const pitch = /^[+-]\d{1,2}Hz$/.test(b.pitch || "") ? b.pitch : "+0Hz";
      // Дмитрий (ru-RU-DmitryNeural) у Microsoft сейчас нестабилен → мужской голос берём из многоязычных.
      const male = /Dmitry|Andrew|Brian|Florian|Remy|William|Giuseppe|Hyunsu/.test(voice);
      const chain = [voice, male ? "en-US-AndrewMultilingualNeural" : "ru-RU-SvetlanaNeural", male ? "en-US-BrianMultilingualNeural" : "en-US-AvaMultilingualNeural"].filter((v, i, a) => a.indexOf(v) === i);
      // Режем длинный текст по предложениям (лимит SSML ~4 КБ).
      const parts: string[] = []; let cur = "";
      for (const sent of text.match(/[^.!?…]+[.!?…]*\s*/g) || [text]) {
        if ((cur + sent).length > 900 && cur) { parts.push(cur.trim()); cur = ""; }
        cur += sent;
      }
      if (cur.trim()) parts.push(cur.trim());
      let err = "";
      for (const v of chain) {
        try {
          const bufs: Uint8Array[] = []; const words: { text: string; start: number; end: number }[] = []; let offset = 0;
          for (const part of parts) {
            const r = await edgeTTS(part, v, rate, pitch);
            for (const w of r.words) words.push({ text: w.text, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3) });
            bufs.push(r.audio); offset += (r.audio.length * 8) / 48000; // 48 kbps CBR
          }
          const len = bufs.reduce((x, c) => x + c.length, 0); const all = new Uint8Array(len); let o2 = 0; for (const c of bufs) { all.set(c, o2); o2 += c.length; }
          return json(o, { mime: "audio/mpeg", data: b64(all.buffer as ArrayBuffer), words, provider: `Microsoft Edge Neural (${v})`, duration: +offset.toFixed(3) });
        } catch (e) { err = String(e); }
      }
      const g = await googleTTS(text, voice.slice(0, 2));
      return json(o, { mime: "audio/mpeg", data: b64(g.buffer as ArrayBuffer), words: [], provider: "Google TTS (запасной)", warning: err });
    }
    if (path === "/proxy") {
      const target = safeUrl(url.searchParams.get("url") || "");
      if (!target) return json(o, { error: "bad url" }, 400);
      const r = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NotebookStudio/1.0)", Accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      const len = +(r.headers.get("content-length") || 0);
      if (len > 25_000_000) return json(o, { error: "file too large" }, 413);
      const body = await r.arrayBuffer();
      if (body.byteLength > 25_000_000) return json(o, { error: "file too large" }, 413);
      return new Response(body, { status: r.status, headers: { ...cors(o), "Content-Type": r.headers.get("content-type") || "application/octet-stream", "x-final-url": r.url } });
    }
    return json(o, { error: "not found" }, 404);
  } catch (e) {
    return json(o, { error: String((e as Error).message || e) }, 502);
  }
});
