import * as api from "./api.js";
import * as store from "./store.js";
import { chunk, search, digest } from "./rag.js";
import { md, esc } from "./md.js";
import { fromFile, fromUrl } from "./sources.js";
import { generateMusic, wavBlob, MOODS } from "./music.js";
import { makeScript, buildAssets, renderMP4 } from "./reel.js";

const $ = (s, r = document) => r.querySelector(s);
const S = { nb: null, notebooks: [], sources: [], notes: [], music: null, lastCites: [] };
window.NS = { api, makeScript, buildAssets, renderMP4, S };

// ---------- утилиты UI ----------
function toast(msg, err = false, ms = 3500) { const t = $("#toast"); t.textContent = msg; t.className = "toast on" + (err ? " err" : ""); clearTimeout(t._h); t._h = setTimeout(() => (t.className = "toast"), ms); }
function modal(title, body, foot = "") {
  $("#mTitle").textContent = title; const b = $("#mBody"); b.innerHTML = ""; if (typeof body === "string") b.innerHTML = body; else b.append(body);
  $("#mFoot").innerHTML = ""; if (typeof foot === "string") $("#mFoot").innerHTML = foot; else $("#mFoot").append(...[foot].flat());
  $("#modal").classList.add("on"); return b;
}
const closeModal = () => $("#modal").classList.remove("on");
$("#mClose").onclick = closeModal; $("#modal").onclick = (e) => { if (e.target.id === "modal" && !document.querySelector("#modal .busy")) closeModal(); };
const btn = (label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + (cls || ""); b.innerHTML = label; b.onclick = fn; return b; };
const h = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild || d; };
const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); };
const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "file";
const selected = () => S.sources.filter((s) => s.on !== false);

// ---------- блокноты ----------
async function loadNotebooks() {
  S.notebooks = (await store.all("notebooks")).sort((a, b) => b.updated - a.updated);
  if (!S.notebooks.length) { const nb = { id: store.uid(), title: "Мой первый блокнот", chat: [], updated: Date.now() }; await store.put("notebooks", nb); S.notebooks = [nb]; }
  const last = localStorage.getItem("ns.nb"); S.nb = S.notebooks.find((n) => n.id === last) || S.notebooks[0];
  renderNbSel(); await openNotebook(S.nb.id);
}
function renderNbSel() { $("#nbSel").innerHTML = S.notebooks.map((n) => `<option value="${n.id}" ${n.id === S.nb?.id ? "selected" : ""}>${esc(n.title)}</option>`).join(""); }
async function openNotebook(id) {
  S.nb = S.notebooks.find((n) => n.id === id); localStorage.setItem("ns.nb", id);
  S.sources = (await store.all("sources")).filter((s) => s.nb === id).sort((a, b) => a.added - b.added);
  S.notes = (await store.all("notes")).filter((s) => s.nb === id).sort((a, b) => b.added - a.added);
  renderSources(); renderChat(); renderNotes(); renderNbSel();
}
const saveNb = async () => { S.nb.updated = Date.now(); await store.put("notebooks", S.nb); };
$("#nbSel").onchange = (e) => openNotebook(e.target.value);
$("#nbNew").onclick = async () => { const t = prompt("Название блокнота", "Новый блокнот"); if (!t) return; const nb = { id: store.uid(), title: t, chat: [], updated: Date.now() }; await store.put("notebooks", nb); S.notebooks.unshift(nb); await openNotebook(nb.id); };
$("#nbRen").onclick = async () => { const t = prompt("Новое название", S.nb.title); if (!t) return; S.nb.title = t; await saveNb(); renderNbSel(); };
$("#nbDel").onclick = async () => {
  if (!confirm(`Удалить блокнот «${S.nb.title}» со всеми источниками и заметками?`)) return;
  for (const s of S.sources) await store.del("sources", s.id); for (const n of S.notes) { await store.del("notes", n.id); await store.del("blobs", n.id); }
  await store.del("notebooks", S.nb.id); localStorage.removeItem("ns.nb"); await loadNotebooks();
};

// ---------- источники ----------
const ICON = { pdf: "📕", url: "🔗", doc: "📄", text: "📝", wiki: "🌐" };
function renderSources() {
  const el = $("#srcList");
  if (!S.sources.length) { el.innerHTML = `<div class="empty">Добавьте PDF, документы, ссылки или текст — и спрашивайте по ним, делайте конспекты, подкасты и рилсы.<br><br>Рилс можно сделать и без источников — на любую тему.</div>`; return; }
  el.innerHTML = S.sources.map((s) => `<div class="src ${s.on !== false ? "on" : ""}" data-id="${s.id}"><div class="ic">${ICON[s.kind] || "📄"}</div><div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="m">${(s.text.length / 1000).toFixed(1)} тыс. символов${s.pages ? ` · ${s.pages} стр.` : ""}</div></div><input type="checkbox" ${s.on !== false ? "checked" : ""} title="Использовать в ответах"><button class="x" title="Удалить">✕</button></div>`).join("");
  el.querySelectorAll(".src").forEach((d) => {
    const s = S.sources.find((x) => x.id === d.dataset.id);
    d.querySelector("input").onclick = async (e) => { e.stopPropagation(); s.on = e.target.checked; await store.put("sources", s); renderSources(); };
    d.querySelector(".x").onclick = async (e) => { e.stopPropagation(); if (!confirm("Удалить источник?")) return; await store.del("sources", s.id); S.sources = S.sources.filter((x) => x !== s); renderSources(); };
    d.onclick = () => modal(s.title, `<div class="m" style="color:var(--muted);margin-bottom:8px">${s.url ? `<a href="${esc(s.url)}" target="_blank">${esc(s.url)}</a>` : ""}</div><div style="white-space:pre-wrap;font-size:14px">${esc(s.text.slice(0, 60000))}${s.text.length > 60000 ? "\n…" : ""}</div>`);
  });
}
async function addSource(src) {
  const text = String(src.text || "").replace(/\u0000/g, "").trim();
  if (text.length < 20) throw new Error("В источнике почти нет текста");
  const s = { id: store.uid(), nb: S.nb.id, title: src.title || "Без названия", kind: src.kind || "text", url: src.url || "", pages: src.pages || 0, text, chunks: chunk(text), on: true, added: Date.now() };
  await store.put("sources", s); S.sources.push(s); renderSources(); await saveNb();
  if (S.nb.title.startsWith("Мой первый") || S.nb.title === "Новый блокнот") { S.nb.title = s.title.slice(0, 60); await saveNb(); renderNbSel(); }
  return s;
}
$("#addSrc").onclick = () => {
  const body = h(`<div><div class="tabs"><button class="btn sm on" data-t="file">Файлы</button><button class="btn sm" data-t="url">Ссылки</button><button class="btn sm" data-t="text">Текст</button><button class="btn sm" data-t="wiki">Найти в Википедии</button></div>
  <div data-p="file"><div class="drop" id="drop">Перетащите сюда PDF, DOCX, TXT, MD, HTML, CSV<br><br><button class="btn sm" id="pick">Выбрать файлы</button><input type="file" id="fin" multiple hidden accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.json,.srt,.vtt"></div></div>
  <div data-p="url" hidden><label class="f">Ссылки на страницы или PDF (по одной в строке)</label><textarea class="inp" id="urls" placeholder="https://..."></textarea></div>
  <div data-p="text" hidden><label class="f">Название</label><input class="inp" id="ttl" placeholder="Например: Заметки о тормозах"><label class="f">Текст</label><textarea class="inp" id="txt" style="min-height:220px" placeholder="Вставьте текст…"></textarea></div>
  <div data-p="wiki" hidden><label class="f">Тема</label><input class="inp" id="wq" placeholder="Например: тормозная система автомобиля"><div id="wres" style="margin-top:10px"></div></div>
  <div class="log" id="alog" style="margin-top:12px;display:none"></div></div>`);
  let tab = "file";
  body.querySelectorAll(".tabs .btn").forEach((b) => (b.onclick = () => { tab = b.dataset.t; body.querySelectorAll(".tabs .btn").forEach((x) => x.classList.toggle("on", x === b)); body.querySelectorAll("[data-p]").forEach((p) => (p.hidden = p.dataset.p !== tab)); }));
  const log = (m) => { const l = body.querySelector("#alog"); l.style.display = "block"; l.textContent += m + "\n"; l.scrollTop = 1e9; };
  const files = async (list) => { for (const f of list) { try { log("Читаю " + f.name + "…"); const r = await fromFile(f); await addSource(r); log("✓ " + f.name); } catch (e) { log("✗ " + f.name + ": " + e.message); } } };
  body.querySelector("#pick").onclick = () => body.querySelector("#fin").click();
  body.querySelector("#fin").onchange = (e) => files([...e.target.files]);
  const drop = body.querySelector("#drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("hov"); }; drop.ondragleave = () => drop.classList.remove("hov");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("hov"); files([...e.dataTransfer.files]); };
  const go = btn("Добавить", "pri", async () => {
    go.disabled = true;
    try {
      if (tab === "url") { for (const u of body.querySelector("#urls").value.split(/\s+/).filter(Boolean)) { try { log("Загружаю " + u + "…"); const r = await fromUrl(u); await addSource(r); log("✓ " + r.title); } catch (e) { log("✗ " + u + ": " + e.message); } } }
      else if (tab === "text") { await addSource({ title: body.querySelector("#ttl").value || "Мой текст", text: body.querySelector("#txt").value, kind: "text" }); log("✓ Текст добавлен"); }
      else if (tab === "wiki") { await wikiSearch(body.querySelector("#wq").value, body.querySelector("#wres"), log); }
      else body.querySelector("#fin").click();
    } catch (e) { log("✗ " + e.message); } finally { go.disabled = false; }
  });
  modal("Добавить источники", body, [btn("Готово", "", closeModal), go]);
};
async function wikiSearch(q, box, log) {
  if (!q.trim()) return;
  const r = await fetch(`https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=6`).then((r) => r.json());
  box.innerHTML = (r.query?.search || []).map((x) => `<div class="note" data-t="${esc(x.title)}"><div class="t">${esc(x.title)}</div><div class="m">${x.snippet.replace(/<[^>]+>/g, "")}…</div></div>`).join("") || "Ничего не найдено";
  box.querySelectorAll(".note").forEach((n) => (n.onclick = async () => {
    log("Загружаю статью «" + n.dataset.t + "»…");
    const d = await fetch(`https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(n.dataset.t)}&format=json&origin=*`).then((r) => r.json());
    const p = Object.values(d.query.pages)[0];
    await addSource({ title: p.title + " — Википедия", text: p.extract.replace(/\n(=+) (.+?) \1/g, "\n## $2"), kind: "wiki", url: "https://ru.wikipedia.org/wiki/" + encodeURIComponent(p.title) });
    log("✓ " + p.title);
  }));
}

// ---------- чат ----------
function renderChat() {
  const el = $("#chat"); const msgs = S.nb.chat || [];
  if (!msgs.length) el.innerHTML = `<div class="empty">Задайте вопрос — ответ будет со ссылками [1] на фрагменты источников.<br>Без источников бот отвечает из общих знаний.</div>`;
  else el.innerHTML = msgs.map((m) => `<div class="msg ${m.role === "user" ? "u" : "a"} ${m.role === "assistant" ? "md" : ""}">${m.role === "user" ? esc(m.content) : md(m.content)}${m.provider ? `<div class="prov">${esc(m.provider)}</div>` : ""}</div>`).join("");
  el.querySelectorAll(".msg.a").forEach((div, i) => { const m = msgs.filter((x) => x.role === "assistant")[i]; div.querySelectorAll(".cite").forEach((c) => (c.onclick = (e) => showCite(e, m.cites?.[+c.dataset.c - 1]))); });
  el.parentElement.scrollTop = 1e9;
  $("#sugg").innerHTML = ["Кратко перескажи главное", "Какие ключевые выводы?", "Придумай 5 идей для рилсов по этой теме", "Объясни простыми словами"].map((s) => `<button class="chip">${s}</button>`).join("");
  $("#sugg").querySelectorAll(".chip").forEach((c) => (c.onclick = () => { $("#q").value = c.textContent; send(); }));
}
function showCite(e, c) {
  const p = $("#pop"); if (!c) return;
  p.innerHTML = `<b>[${c.n}] ${esc(c.title)}</b><div style="white-space:pre-wrap;margin-top:6px;max-height:260px;overflow:auto">${esc(c.text)}</div>`;
  p.style.left = Math.min(e.clientX, innerWidth - 440) + "px"; p.style.top = Math.min(e.clientY + 12, innerHeight - 300) + "px"; p.classList.add("on");
  setTimeout(() => document.addEventListener("click", () => p.classList.remove("on"), { once: true }), 0);
}
async function send() {
  const q = $("#q").value.trim(); if (!q) return; $("#q").value = "";
  S.nb.chat = S.nb.chat || []; S.nb.chat.push({ role: "user", content: q }); renderChat();
  const wait = h(`<div class="msg a"><span class="spin"></span> Думаю…</div>`); $("#chat").append(wait); $("#chat").parentElement.scrollTop = 1e9;
  try {
    const src = selected(); let sys, ctx = "", cites = [];
    if (src.length) {
      const hits = search(src, q + " " + (S.nb.chat.slice(-3, -1).map((m) => m.content).join(" ")).slice(0, 300), 8);
      cites = hits.map((d, i) => ({ n: i + 1, title: d.src.title, text: d.text }));
      ctx = cites.map((c) => `[${c.n}] (${c.title})\n${c.text}`).join("\n\n");
      sys = `Ты — исследовательский ассистент как NotebookLM. Отвечай по-русски, опираясь ТОЛЬКО на фрагменты источников ниже. После каждого утверждения ставь ссылку на номер фрагмента в квадратных скобках, например [1] или [2][3]. Если в источниках нет ответа — честно скажи об этом и, если уместно, добавь общий ответ с пометкой «(не из источников)». Используй markdown: короткие абзацы, списки, жирный для главного.\n\nФрагменты источников:\n${ctx}`;
    } else sys = "Ты — полезный ассистент. Отвечай по-русски, структурно, используя markdown. Источников нет, отвечай из общих знаний и предупреждай, если не уверен.";
    const hist = S.nb.chat.slice(-9, -1).map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));
    const r = await api.llm([{ role: "system", content: sys }, ...hist, { role: "user", content: q }], { temperature: 0.3, max_tokens: 1800 });
    S.nb.chat.push({ role: "assistant", content: r.text.trim(), cites, provider: r.provider + (cites.length ? ` · ${cites.length} фрагментов` : "") });
  } catch (e) { S.nb.chat.push({ role: "assistant", content: "⚠️ Ошибка: " + e.message }); }
  await saveNb(); renderChat();
}
$("#send").onclick = send; $("#q").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
$("#chatClear").onclick = async () => { S.nb.chat = []; await saveNb(); renderChat(); };

// ---------- заметки (результаты студии) ----------
function renderNotes() {
  const el = $("#notes");
  el.innerHTML = S.notes.length ? S.notes.map((n) => `<div class="note" data-id="${n.id}"><div class="t">${{ md: "📝", audio: "🎧", video: "🎬", image: "🖼", music: "🎵" }[n.type] || "📝"} ${esc(n.title)}</div><div class="m">${new Date(n.added).toLocaleString("ru-RU")}</div></div>`).join("") : `<div class="empty">Здесь появятся сохранённые конспекты, подкасты, картинки и рилсы</div>`;
  el.querySelectorAll(".note").forEach((d) => (d.onclick = () => openNote(S.notes.find((n) => n.id === d.dataset.id))));
}
async function saveNote(note, blob) {
  const n = { id: store.uid(), nb: S.nb.id, added: Date.now(), ...note }; await store.put("notes", n);
  if (blob) await store.put("blobs", { id: n.id, blob }); S.notes.unshift(n); renderNotes(); toast("Сохранено в блокнот"); return n;
}
async function openNote(n) {
  const b = (await store.get("blobs", n.id))?.blob; const url = b ? URL.createObjectURL(b) : "";
  const del = btn("Удалить", "", async () => { await store.del("notes", n.id); await store.del("blobs", n.id); S.notes = S.notes.filter((x) => x !== n); renderNotes(); closeModal(); });
  if (n.type === "video") modal(n.title, `<div class="reelwrap"><video src="${url}" controls playsinline></video><div class="md">${md(n.content || "")}</div></div>`, [del, btn("⬇ Скачать MP4", "pri", () => download(b, slug(n.title) + "." + (n.ext || "mp4")))]);
  else if (n.type === "audio" || n.type === "music") modal(n.title, `<audio src="${url}" controls style="width:100%"></audio><div class="md" style="margin-top:12px">${md(n.content || "")}</div>`, [del, btn("⬇ Скачать", "pri", () => download(b, slug(n.title) + ".wav"))]);
  else if (n.type === "image") modal(n.title, `<img src="${url}" style="max-width:100%;max-height:70vh;border-radius:12px;display:block;margin:auto"><p class="m">${esc(n.content || "")}</p>`, [del, btn("⬇ Скачать", "pri", () => download(b, slug(n.title) + ".jpg"))]);
  else showText(n.title, n.content, false, del);
}
function showText(title, text, savable = true, extra = null) {
  const foot = [btn("Копировать", "", () => { navigator.clipboard.writeText(text); toast("Скопировано"); }), btn("⬇ .md", "", () => download(new Blob([text], { type: "text/markdown" }), slug(title) + ".md"))];
  if (extra) foot.unshift(extra);
  if (savable) foot.push(btn("Сохранить в блокнот", "pri", async () => { await saveNote({ type: "md", title, content: text }); }));
  modal(title, `<div class="md">${md(text)}</div>`, foot);
}

// ---------- студия: текстовые форматы ----------
const PROMPTS = {
  summary: ["Краткий обзор", "Сделай краткий обзор материалов: 1 абзац сути, затем 5–8 ключевых пунктов, затем «Что важно запомнить». Markdown."],
  guide: ["Учебное пособие", "Составь учебное пособие: ## Ключевые понятия (термин — объяснение), ## Короткий конспект по разделам, ## 10 вопросов для самопроверки с краткими ответами, ## Мини-тест из 5 вопросов с вариантами и правильными ответами. Markdown."],
  faq: ["FAQ", "Составь FAQ из 10–12 самых полезных вопросов и чётких ответов по материалам. Формат: ### Вопрос, затем ответ. Markdown."],
  brief: ["Брифинг", "Подготовь брифинг-документ для руководителя: ## Резюме, ## Основные темы и выводы, ## Цифры и факты, ## Риски и открытые вопросы, ## Рекомендации. Markdown, деловой стиль."],
  timeline: ["Хронология", "Составь хронологию событий/этапов из материалов (таблица: Дата/Этап | Событие), затем список ключевых участников с ролями. Если дат нет — логическая последовательность шагов. Markdown."],
};
async function needContext(askTopic = true) {
  const src = selected(); if (src.length) return { ctx: digest(src), topic: S.nb.title };
  if (!askTopic) return null;
  const t = prompt("Источников нет. На какую тему сделать?", ""); if (!t) return null;
  return { ctx: "", topic: t };
}
async function runText(kind) {
  const [title, task] = PROMPTS[kind]; const c = await needContext(); if (!c) return;
  const b = modal(title, `<div class="busy"><span class="spin"></span> Генерирую «${title}»…</div>`);
  try {
    const r = await api.llm([{ role: "system", content: "Ты — эксперт-редактор. Пишешь по-русски ясно и структурно. Опирайся на материалы, не выдумывай факты." }, { role: "user", content: `${task}\n\n${c.ctx ? `Материалы:\n"""\n${c.ctx}\n"""` : `Тема: ${c.topic}`}` }], { temperature: 0.4, max_tokens: 3500 });
    showText(`${title}: ${c.topic}`.slice(0, 90), r.text.trim() + `\n\n_Сгенерировано: ${r.provider}_`);
  } catch (e) { b.innerHTML = `<p style="color:var(--danger)">Ошибка: ${esc(e.message)}</p>`; }
}
function postDialog() {
  const body = h(`<div><div class="row"><div><label class="f">Формат</label><select class="inp" id="pk"><option>Пост для Instagram</option><option>Пост для Telegram-канала</option><option>Статья для блога (SEO)</option><option>Сценарий для YouTube-видео</option><option>Email-рассылка</option><option>Карусель (10 слайдов)</option><option>Продающий текст для лендинга</option></select></div>
  <div><label class="f">Тон</label><select class="inp" id="pt"><option>дружелюбный и живой</option><option>экспертный</option><option>продающий</option><option>с юмором</option><option>официальный</option></select></div></div>
  <label class="f">Тема (если пусто — по источникам)</label><input class="inp" id="ptopic" placeholder="${esc(S.nb.title)}"><label class="f">Пожелания</label><input class="inp" id="pw" placeholder="Например: для автосервиса в Алматы, с призывом записаться"></div>`);
  const go = btn("Написать", "pri", async () => {
    const kind = body.querySelector("#pk").value, tone = body.querySelector("#pt").value, topic = body.querySelector("#ptopic").value.trim(), wish = body.querySelector("#pw").value.trim();
    const src = selected(); const ctx = !topic || src.length ? digest(src, 14000) : "";
    go.disabled = true; go.innerHTML = '<span class="spin"></span> Пишу…';
    try {
      const r = await api.llm([{ role: "system", content: "Ты — сильный SMM-копирайтер и редактор. Пишешь по-русски, цепко, без штампов и воды." }, { role: "user", content: `Напиши: ${kind}. Тон: ${tone}. ${topic ? "Тема: " + topic + "." : ""} ${wish}\nДобавь сильный первый абзац-хук, структуру, призыв к действию, для соцсетей — 5–8 хэштегов.${ctx ? `\nМатериалы:\n"""\n${ctx}\n"""` : ""}` }], { temperature: 0.8, max_tokens: 3000 });
      showText(`${kind}: ${topic || S.nb.title}`.slice(0, 90), r.text.trim());
    } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = "Написать"; }
  });
  modal("Пост / текст", body, go);
}

// ---------- картинки ----------
function imageDialog() {
  const body = h(`<div><div class="tabs"><button class="btn sm on" data-m="ai">🎨 Нарисовать (ИИ)</button><button class="btn sm" data-m="stock">📷 Найти фото (сток)</button></div>
  <label class="f">Что изобразить (можно по-русски)</label><textarea class="inp" id="ip" style="min-height:70px" placeholder="Например: механик проверяет тормозные колодки в современном автосервисе"></textarea>
  <div class="row"><div><label class="f">Формат</label><select class="inp" id="ia"><option value="1080x1920">9:16 (рилс, сторис)</option><option value="1080x1350">4:5 (пост)</option><option value="1080x1080">1:1</option><option value="1920x1080">16:9</option></select></div><div><label class="f">Стиль</label><select class="inp" id="is"><option value="photorealistic, cinematic lighting, 35mm photo, high detail">Фото (реализм)</option><option value="3d render, pixar style, soft light">3D</option><option value="flat vector illustration, clean, minimal">Иллюстрация</option><option value="digital painting, artstation, dramatic">Арт</option><option value="anime style, vibrant">Аниме</option></select></div><div><label class="f">Сколько</label><select class="inp" id="in"><option>1</option><option selected>2</option><option>4</option></select></div></div>
  <div class="imgs" id="ires" style="margin-top:14px"></div></div>`);
  let mode = "ai";
  body.querySelectorAll(".tabs .btn").forEach((b) => (b.onclick = () => { mode = b.dataset.m; body.querySelectorAll(".tabs .btn").forEach((x) => x.classList.toggle("on", x === b)); }));
  const res = body.querySelector("#ires");
  const add = (blob, cap) => { const url = URL.createObjectURL(blob); const f = h(`<figure><img src="${url}"><figcaption>${esc(cap)}</figcaption></figure>`); const row = h(`<div class="row" style="gap:4px;margin-top:4px"></div>`); row.append(btn("⬇", "sm", () => download(blob, "image.jpg")), btn("В блокнот", "sm", () => saveNote({ type: "image", title: body.querySelector("#ip").value.slice(0, 60) || "Картинка", content: cap }, blob))); f.append(row); res.append(f); };
  const go = btn("Создать", "pri", async () => {
    const p = body.querySelector("#ip").value.trim(); if (!p) return toast("Опишите картинку", true);
    go.disabled = true; go.innerHTML = '<span class="spin"></span> Работаю…'; res.innerHTML = "";
    try {
      const [w, hh] = body.querySelector("#ia").value.split("x").map(Number); const n = +body.querySelector("#in").value;
      const tr = await api.llmJSON([{ role: "user", content: `Преобразуй описание в JSON {"prompt":"подробный англоязычный промпт для генерации изображения (объект, окружение, свет, ракурс), без текста на картинке","query":"2-4 английских слова для поиска стокового фото"}. Описание: ${p}` }], { temperature: 0.4, max_tokens: 400 }).catch(() => ({ data: { prompt: p, query: p } }));
      if (mode === "ai") {
        const style = body.querySelector("#is").value;
        await Promise.all(Array.from({ length: n }, async (_, i) => { await new Promise((r) => setTimeout(r, i * 1200)); try { const r = await api.genImage(`${tr.data.prompt}, ${style}, no text, no watermark`, { width: w, height: hh }); add(r.blob, r.provider); } catch (e) { toast("Картинка не получилась: " + e.message, true); } }));
      } else {
        const list = await api.stock(tr.data.query || p, w >= hh ? "landscape" : "portrait");
        if (!list.length) toast("Ничего не нашлось — попробуйте другие слова", true);
        for (const x of list.slice(0, Math.max(n, 6))) { try { add(await api.fetchBlob(x.thumb || x.url), `${x.author ? x.author + " · " : ""}${x.license} · ${x.provider}`); } catch { /**/ } }
      }
    } catch (e) { toast(e.message, true); }
    go.disabled = false; go.textContent = "Создать";
  });
  modal("Картинки", body, go);
}

// ---------- музыка ----------
function musicDialog() {
  const body = h(`<div><p style="color:var(--muted);margin-top:0">Трек синтезируется прямо в браузере — без авторских прав, можно использовать в рилсах и рекламе. Можно загрузить и свой трек — он будет подкладываться в рилсы.</p>
  <div class="row"><div><label class="f">Настроение</label><select class="inp" id="mm">${Object.entries(MOODS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("")}</select></div><div><label class="f">Длительность, с</label><input class="inp" id="md" type="number" value="45" min="10" max="240"></div><div><label class="f">Вариант</label><input class="inp" id="ms" type="number" value="1" min="1" max="99"></div></div>
  <div id="mres" style="margin-top:14px"></div><label class="f">…или свой трек для рилсов (mp3/wav)</label><input type="file" id="mf" accept="audio/*" class="inp"></div>`);
  body.querySelector("#mf").onchange = (e) => { S.music = e.target.files[0] || null; toast(S.music ? "Трек будет использован в рилсах: " + S.music.name : "Свой трек убран"); };
  const go = btn("Сгенерировать", "pri", async () => {
    go.disabled = true; go.innerHTML = '<span class="spin"></span> Синтез…';
    try {
      const mood = body.querySelector("#mm").value; const buf = await generateMusic(+body.querySelector("#md").value || 45, mood, +body.querySelector("#ms").value || 1); const blob = wavBlob(buf);
      const r = body.querySelector("#mres"); r.innerHTML = `<audio controls src="${URL.createObjectURL(blob)}" style="width:100%"></audio>`;
      const row = h(`<div class="row" style="margin-top:8px"></div>`); row.append(btn("⬇ WAV", "", () => download(blob, `music-${mood}.wav`)), btn("Использовать в рилсах", "", () => { S.music = new File([blob], `music-${mood}.wav`, { type: "audio/wav" }); toast("Этот трек будет в следующих рилсах"); }), btn("В блокнот", "", () => saveNote({ type: "music", title: "Музыка: " + MOODS[mood].name, content: "Синтез в браузере, без авторских прав" }, blob))); r.append(row);
    } catch (e) { toast(e.message, true); }
    go.disabled = false; go.textContent = "Сгенерировать";
  });
  modal("Музыка", body, go);
}

// ---------- аудиопересказ (подкаст) ----------
async function podcast() {
  const c = await needContext(); if (!c) return;
  const body = modal("Аудиопересказ", `<div class="busy"><p><span class="spin"></span> Пишу сценарий подкаста…</p><div class="prog"><i id="pp"></i></div><div class="log" id="plog"></div></div>`);
  const log = (m) => { const l = body.querySelector("#plog"); l.textContent += m + "\n"; l.scrollTop = 1e9; };
  try {
    const { data, provider } = await api.llmJSON([{ role: "system", content: "Ты пишешь сценарии живых научно-популярных подкастов на русском. Отвечай только JSON." }, { role: "user", content: `Напиши диалог двух ведущих (Анна — ведущая, задаёт вопросы и подводит итоги; Максим — эксперт, объясняет на примерах) на 3–5 минут: 16–24 реплики, естественная разговорная речь, без ремарок. Начни с приветствия и интриги, закончи выводами. Числа словами.\n${c.ctx ? `Материалы:\n"""\n${c.ctx.slice(0, 16000)}\n"""` : `Тема: ${c.topic}`}\nJSON: {"title":"название выпуска","lines":[{"s":"A","t":"реплика"},{"s":"B","t":"реплика"}]}` }], { temperature: 0.8, max_tokens: 4000 });
    const lines = (data.lines || []).filter((l) => l.t); log(`Сценарий: ${lines.length} реплик (${provider})`);
    const ac = new AudioContext({ sampleRate: 48000 }); let done = 0;
    const bufs = []; let i = 0;
    await Promise.all(Array.from({ length: 3 }, async () => { while (i < lines.length) { const k = i++; const l = lines[k]; const r = await api.tts(l.t, l.s === "B" ? api.settings.voiceB : api.settings.voiceA, "+0%"); bufs[k] = await ac.decodeAudioData(await r.blob.arrayBuffer()); body.querySelector("#pp").style.width = (++done / lines.length * 100) + "%"; if (k === 0) log("Голоса: " + r.provider); } }));
    const gap = 0.35, total = bufs.reduce((a, b) => a + b.duration + gap, 1.5);
    const off = new OfflineAudioContext(2, Math.ceil(48000 * total), 48000); let t = 0.8;
    const music = await generateMusic(Math.min(total, 12), "calm", 3); const ms = off.createBufferSource(); ms.buffer = music; const mg = off.createGain(); mg.gain.value = 0.25; ms.connect(mg).connect(off.destination); ms.start(0);
    bufs.forEach((b, k) => { const s = off.createBufferSource(); s.buffer = b; const p = off.createStereoPanner(); p.pan.value = lines[k].s === "B" ? 0.12 : -0.12; s.connect(p).connect(off.destination); s.start(t); t += b.duration + gap; });
    const mix = await off.startRendering(); ac.close(); const blob = wavBlob(mix);
    const transcript = lines.map((l) => `**${l.s === "B" ? "Максим" : "Анна"}:** ${l.t}`).join("\n\n");
    const title = "🎧 " + (data.title || c.topic);
    modal(title, `<audio controls src="${URL.createObjectURL(blob)}" style="width:100%"></audio><p style="color:var(--muted);font-size:12px">${Math.round(total / 60)} мин · текст: ${esc(provider)} · голоса: Microsoft Neural</p><div class="md">${md(transcript)}</div>`,
      [btn("⬇ WAV", "", () => download(blob, slug(title) + ".wav")), btn("Сохранить в блокнот", "pri", () => saveNote({ type: "audio", title, content: transcript }, blob))]);
  } catch (e) { log("Ошибка: " + e.message); body.querySelector(".busy").classList.remove("busy"); }
}

// ---------- рилс ----------
function reelDialog() {
  const hasSrc = selected().length > 0;
  const body = h(`<div><label class="f">Тема рилса — любая</label><input class="inp" id="rt" placeholder="Например: 5 признаков, что пора менять тормозные колодки" value="">
  <div class="row"><div><label class="f">Длительность</label><select class="inp" id="rd"><option value="30">30 секунд</option><option value="45" selected>45 секунд</option><option value="60">60 секунд</option></select></div>
  <div><label class="f">Картинки</label><select class="inp" id="rv"><option value="ai">ИИ рисует</option><option value="stock">Сток-фото</option></select></div>
  <div><label class="f">Голос</label><select class="inp" id="rvo"><option value="ru-RU-SvetlanaNeural">Светлана (жен.)</option><option value="en-US-AndrewMultilingualNeural">Андрей (муж.)</option><option value="en-US-BrianMultilingualNeural">Брайан (муж., мягкий)</option><option value="en-US-AvaMultilingualNeural">Ава (жен., мягкий)</option></select></div>
  <div><label class="f">Музыка</label><select class="inp" id="rm"><option value="">Авто по теме</option>${Object.entries(MOODS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("")}</select></div></div>
  <div class="row"><div><label class="f">Тон</label><select class="inp" id="rtone"><option>экспертно и живо</option><option>энергично и дерзко</option><option>с юмором</option><option>спокойно и доверительно</option><option>продающе</option></select></div><div><label class="f">Подпись на видео (@ник)</label><input class="inp" id="rh" value="${esc(api.settings.handle)}" placeholder="@avtomaster24"></div><div><label class="f">Цвет акцента</label><input class="inp" id="rc" type="color" value="${api.settings.accent}" style="height:42px;padding:4px"></div></div>
  <label style="display:flex;gap:8px;align-items:center;margin-top:10px;color:var(--muted)"><input type="checkbox" id="rs" ${hasSrc ? "checked" : "disabled"}> Опираться на источники блокнота ${hasSrc ? `(${selected().length})` : "(нет источников)"}</label>
  ${S.music ? `<p style="color:var(--muted)">🎵 Будет использован ваш трек: ${esc(S.music.name)}</p>` : ""}
  <div id="rsb"></div></div>`);
  let script = null;
  const genBtn = btn("1. Написать сценарий", "pri", async () => {
    const topic = body.querySelector("#rt").value.trim(); if (!topic) return toast("Введите тему", true);
    genBtn.disabled = true; genBtn.innerHTML = '<span class="spin"></span> Пишу сценарий…';
    try {
      const ctx = body.querySelector("#rs").checked ? search(selected(), topic, 10).map((d) => d.text).join("\n\n") : "";
      script = await makeScript({ topic, context: ctx, duration: +body.querySelector("#rd").value, tone: body.querySelector("#rtone").value });
      renderStoryboard();
      buildBtn.disabled = false;
    } catch (e) { toast(e.message, true); }
    genBtn.disabled = false; genBtn.textContent = "↻ Переписать сценарий";
  });
  const renderStoryboard = () => {
    const sb = body.querySelector("#rsb");
    sb.innerHTML = `<div class="sec">Сценарий · ${esc(script.provider)}</div><label class="f">Заголовок на экране (хук)</label><input class="inp" data-k="hook" value="${esc(script.hook)}">` +
      script.scenes.map((s, i) => `<div class="note" style="cursor:default"><div class="row"><div style="flex:3"><label class="f">Сцена ${i + 1} — озвучка</label><textarea class="inp" data-i="${i}" data-k="voice" style="min-height:60px">${esc(s.voice)}</textarea></div><div style="flex:2"><label class="f">Подпись</label><input class="inp" data-i="${i}" data-k="label" value="${esc(s.label)}"><label class="f">Картинка (промпт)</label><input class="inp" data-i="${i}" data-k="image_prompt" value="${esc(s.image_prompt)}"></div></div></div>`).join("") +
      `<div class="sec">Подпись к посту</div><div class="md">${esc(script.caption)}<br><span style="color:var(--accent)">${esc(script.hashtags.join(" "))}</span></div>`;
    sb.querySelectorAll("[data-k]").forEach((el) => (el.oninput = () => { if (el.dataset.i) script.scenes[+el.dataset.i][el.dataset.k] = el.value; else script[el.dataset.k] = el.value; }));
  };
  const buildBtn = btn("2. Собрать видео", "pri", async () => {
    api.settings.handle = body.querySelector("#rh").value.trim(); api.settings.accent = body.querySelector("#rc").value; api.saveSettings();
    await buildReel(script, { mode: body.querySelector("#rv").value, voice: body.querySelector("#rvo").value, musicMood: body.querySelector("#rm").value });
  });
  buildBtn.disabled = true; buildBtn.id = "buildBtn"; genBtn.id = "scriptBtn";
  modal("🎬 Рилс на любую тему", body, [genBtn, buildBtn]);
}
async function buildReel(script, opts) {
  const body = modal("🎬 Сборка рилса: " + script.title, `<div class="busy reelwrap"><canvas id="rcv" width="1080" height="1920"></canvas><div><p id="rstage"><span class="spin"></span> Готовлю материалы…</p><div class="prog"><i id="rp"></i></div><div class="log" id="rlog" style="max-height:420px"></div></div></div>`);
  const log = (m) => { const l = body.querySelector("#rlog"); l.textContent += m + "\n"; l.scrollTop = 1e9; };
  const bar = (p) => (body.querySelector("#rp").style.width = (p * 100).toFixed(1) + "%");
  try {
    const t0 = performance.now();
    const A = await buildAssets(script, { ...opts, musicFile: S.music, log, progress: (p) => bar(p * 0.4) });
    log(`Таймлайн: ${A.total.toFixed(1)} с, сцен: ${A.scenes.length}`);
    body.querySelector("#rstage").innerHTML = '<span class="spin"></span> Рендер видео 1080×1920…';
    const out = await renderMP4(A, { canvas: body.querySelector("#rcv"), onProgress: (p) => bar(0.4 + p * 0.6) });
    log(`Готово за ${((performance.now() - t0) / 1000).toFixed(0)} с · ${(out.blob.size / 1e6).toFixed(1)} МБ · видео ${out.video}, звук ${out.audio}`);
    const url = URL.createObjectURL(out.blob); window.__lastReel = out.blob;
    const caption = `${script.caption}\n\n${script.hashtags.join(" ")}${A.credits.length ? `\n\nФото: ${A.credits.join("; ")}` : ""}`;
    const info = `**${script.title}**\n\n${caption}\n\n_Текст: ${script.provider} · Голос: ${A.voiceProvider} · Картинки: ${A.credits.join(", ") || "—"} · Музыка: ${S.music ? S.music.name : "синтез, без АП"}_`;
    const fname = slug(script.title) + "." + out.ext;
    modal("🎬 " + script.title, `<div class="reelwrap"><video id="rvid" src="${url}" controls playsinline autoplay muted></video><div><div class="md">${md(info)}</div></div></div>`,
      [btn("Копировать подпись", "", () => { navigator.clipboard.writeText(caption); toast("Скопировано"); }), btn("Сохранить в блокнот", "", () => saveNote({ type: "video", title: "Рилс: " + script.title, content: info, ext: out.ext }, out.blob)), btn(`⬇ Скачать ${out.ext.toUpperCase()}`, "pri", () => download(out.blob, fname))]);
    $("#rvid").dataset.ready = "1";
  } catch (e) { console.error(e); log("Ошибка: " + (e.message || e)); body.querySelector("#rstage").textContent = "Не получилось — см. журнал"; body.querySelector(".busy")?.classList.remove("busy"); }
}

// ---------- настройки ----------
$("#setBtn").onclick = () => {
  const s = api.settings;
  const body = h(`<div><p style="color:var(--muted);margin-top:0">Ключи хранятся только в этом браузере и передаются на ваш сервер Supabase по HTTPS. Без ключей всё работает на бесплатных сервисах.</p>
  <label class="f">Agnes AI API key (тот же, что в «контент-заводе» — лучший текст и картинки)</label><input class="inp" id="k1" type="password" value="${esc(s.agnesKey)}" placeholder="необязательно">
  <label class="f">Pollinations API key (enter.pollinations.ai — сильные модели, большие картинки)</label><input class="inp" id="k2" type="password" value="${esc(s.pollinationsKey)}" placeholder="необязательно">
  <label class="f">Pexels API key (pexels.com/api — качественные сток-фото)</label><input class="inp" id="k3" type="password" value="${esc(s.pexelsKey)}" placeholder="необязательно">
  <div class="row"><div><label class="f">Голос ведущей</label><input class="inp" id="va" value="${esc(s.voiceA)}"></div><div><label class="f">Голос эксперта</label><input class="inp" id="vb" value="${esc(s.voiceB)}"></div><div><label class="f">Скорость речи</label><input class="inp" id="vr" value="${esc(s.rate)}"></div></div>
  <label class="f">Адрес сервера</label><input class="inp" id="be" value="${esc(s.backend)}">
  <p style="color:var(--muted);font-size:13px" id="hs">${esc(api.providersText())}</p></div>`);
  modal("Настройки", body, btn("Сохранить", "pri", async () => {
    Object.assign(s, { agnesKey: body.querySelector("#k1").value.trim(), pollinationsKey: body.querySelector("#k2").value.trim(), pexelsKey: body.querySelector("#k3").value.trim(), voiceA: body.querySelector("#va").value.trim(), voiceB: body.querySelector("#vb").value.trim(), rate: body.querySelector("#vr").value.trim() || "+5%", backend: body.querySelector("#be").value.trim() || api.DEFAULT_BACKEND });
    api.saveSettings(); await api.checkHealth(); $("#provBadge").textContent = api.providersText(); closeModal(); toast("Настройки сохранены");
  }));
};

// ---------- студия: кнопки ----------
document.querySelectorAll(".tile").forEach((t) => (t.onclick = () => {
  const a = t.dataset.act;
  if (PROMPTS[a]) return runText(a);
  ({ reel: reelDialog, podcast, post: postDialog, image: imageDialog, music: musicDialog })[a]?.();
}));
document.querySelectorAll("#mtabs .btn").forEach((b) => (b.onclick = () => { document.querySelectorAll("#mtabs .btn").forEach((x) => x.classList.toggle("on", x === b)); document.querySelectorAll(".grid>.panel").forEach((p) => p.classList.toggle("mon", p.id === b.dataset.p)); }));

(async () => {
  await loadNotebooks();
  await api.checkHealth(); $("#provBadge").textContent = api.providersText();
  const q = new URLSearchParams(location.search).get("reel"); if (q) { reelDialog(); $("#rt").value = q; }
})();
