// Связь с серверной частью (Supabase Edge Function) и прямые бесплатные сервисы.
export const DEFAULT_BACKEND = "https://sfgrwquitlnzlkyzashb.supabase.co/functions/v1/notebook-studio";
const LS = "ns.settings";
export const settings = Object.assign({
  backend: DEFAULT_BACKEND, agnesKey: "", pollinationsKey: "", pexelsKey: "",
  voiceA: "ru-RU-SvetlanaNeural", voiceB: "en-US-AndrewMultilingualNeural", rate: "+5%",
  accent: "#19e3b1", handle: "", imageMode: "ai",
}, JSON.parse(localStorage.getItem(LS) || "{}"));
export const saveSettings = () => localStorage.setItem(LS, JSON.stringify(settings));
export let health = null;

function headers(extra = {}) {
  const h = { "Content-Type": "application/json", ...extra };
  if (settings.agnesKey) h["x-agnes-key"] = settings.agnesKey;
  if (settings.pollinationsKey) h["x-pollinations-key"] = settings.pollinationsKey;
  if (settings.pexelsKey) h["x-pexels-key"] = settings.pexelsKey;
  return h;
}
async function call(path, body, { method = body ? "POST" : "GET", timeout = 180000 } = {}) {
  const r = await fetch(settings.backend + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  let d; try { d = await r.json(); } catch { throw new Error(`Сервер ответил ${r.status}`); }
  if (!r.ok || d.error) throw new Error(d.error || `Ошибка ${r.status}`);
  return d;
}
export async function checkHealth() { try { health = await call("/health", null, { timeout: 15000 }); } catch (e) { health = null; } return health; }
export function providersText() {
  if (!health) return "сервер недоступен";
  const t = settings.agnesKey || health.text === "agnes" ? "Agnes AI" : settings.pollinationsKey || health.text === "pollinations-key" ? "Pollinations Pro" : "Pollinations (бесплатно)";
  return `Текст: ${t} · Голос: Microsoft Neural`;
}

// Бесплатный режим: браузер обращается к Pollinations напрямую (квота считается по IP пользователя).
async function pollinationsDirect(messages, opts) {
  let err;
  const waits = [2000, 8000, 20000, 30000];
  for (let i = 0; i < waits.length; i++) {
    let st = 0;
    try {
      const r = await fetch("https://text.pollinations.ai/openai", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(150000),
        body: JSON.stringify({ model: "openai-fast", reasoning_effort: "low", messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.max_tokens ?? 2500, seed: Math.floor(Math.random() * 1e6), ...(opts.json ? { response_format: { type: "json_object" } } : {}) }) });
      st = r.status;
      if (!r.ok) throw new Error(r.status === 402 || r.status === 429 ? "бесплатный лимит Pollinations временно исчерпан (" + r.status + ")" : "Pollinations " + r.status);
      const d = await r.json(); const text = d?.choices?.[0]?.message?.content;
      if (text && text.trim()) return { text, provider: `Pollinations (${d.model || "openai-fast"}, бесплатно)` };
      throw new Error("пустой ответ");
    } catch (e) { err = e; if (i < waits.length - 1) await new Promise((res) => setTimeout(res, st === 402 || st === 429 ? waits[i] + 5000 : waits[i])); }
  }
  throw err;
}
export async function llm(messages, opts = {}) {
  const serverHasKey = settings.agnesKey || settings.pollinationsKey || (health && health.text !== "pollinations-free");
  const viaServer = async () => { const d = await call("/llm", { messages, temperature: opts.temperature ?? 0.6, max_tokens: opts.max_tokens ?? 2500, json: !!opts.json }); return { text: d.text, provider: d.provider }; };
  if (serverHasKey) { try { return await viaServer(); } catch (e) { console.warn("server llm", e); return await pollinationsDirect(messages, opts); } }
  try { return await pollinationsDirect(messages, opts); } catch (e) { console.warn("direct llm", e); return await viaServer(); }
}
export function parseJSON(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* ищем первый объект */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { const s = t.slice(a, b + 1); try { return JSON.parse(s); } catch { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } }
  throw new Error("Модель вернула не JSON");
}
export async function llmJSON(messages, opts = {}, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await llm(messages, { ...opts, json: true }); return { data: parseJSON(r.text), provider: r.provider }; }
    catch (e) { last = e; }
  }
  throw last;
}

const b64ToBlob = (b64, mime) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };

export async function tts(text, voice = settings.voiceA, rate = settings.rate) {
  const d = await call("/tts", { text, voice, rate });
  return { blob: b64ToBlob(d.data, d.mime), words: d.words || [], provider: d.provider, duration: d.duration };
}

// Картинки: при наличии ключа (Agnes/Pollinations) — через сервер; иначе браузер сам обращается к Pollinations (бесплатно).
export async function genImage(prompt, { width = 1080, height = 1920, seed = Math.floor(Math.random() * 1e9) } = {}) {
  const serverKey = settings.agnesKey || settings.pollinationsKey || (health && health.image !== "pollinations-flux");
  if (serverKey) {
    try { const d = await call("/image", { prompt, width, height, seed }); return { blob: b64ToBlob(d.data, d.mime), provider: d.provider }; }
    catch (e) { console.warn("server image failed", e); }
  }
  let err;
  for (let i = 0; i < 4; i++) {
    try {
      const u = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed + i}&nologo=true&model=flux`;
      const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.startsWith("image/")) return { blob: await r.blob(), provider: "Pollinations (бесплатно)" };
      err = new Error("Pollinations " + r.status);
    } catch (e) { err = e; }
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
  throw err;
}
export async function stock(q, orientation = "portrait") { return (await call(`/stock?q=${encodeURIComponent(q)}&orientation=${orientation}`)).results || []; }
export async function fetchBlob(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.blob(); } catch { /* CORS → прокси */ }
  const r = await fetch(`${settings.backend}/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error("Не удалось загрузить " + url);
  return await r.blob();
}
export async function proxyText(url) {
  const r = await fetch(`${settings.backend}/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Страница не открылась (${r.status})`);
  return { text: await r.text(), type: r.headers.get("content-type") || "", blob: null };
}
