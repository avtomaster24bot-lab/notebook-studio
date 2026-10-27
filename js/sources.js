// Загрузка источников: текст, ссылка (статья/YouTube-описание), PDF, DOCX, TXT/MD/CSV/HTML.
import { proxyText } from "./api.js";
export function htmlToText(html, baseTitle = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,aside,form,iframe,button,[aria-hidden=true]").forEach((n) => n.remove());
  const title = (doc.querySelector("meta[property='og:title']")?.content || doc.title || baseTitle).trim();
  const root = doc.querySelector("article") || doc.querySelector("main") || doc.body;
  const blocks = [];
  root?.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre,td").forEach((n) => {
    const t = n.textContent.replace(/\s+/g, " ").trim();
    if (t.length < 2) return;
    blocks.push(/^H\d/.test(n.tagName) ? `## ${t}` : n.tagName === "LI" ? `- ${t}` : t);
  });
  let text = blocks.join("\n\n");
  if (text.length < 200) text = (root?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  const desc = doc.querySelector("meta[name='description'],meta[property='og:description']")?.content || "";
  if (desc && !text.includes(desc.slice(0, 40))) text = desc + "\n\n" + text;
  return { title: title || baseTitle, text };
}
export async function fromUrl(url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  if (/\.pdf($|\?)/i.test(url)) {
    const r = await fetch(`${(await import("./api.js")).settings.backend}/proxy?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error("PDF не скачался");
    return { ...(await fromPdf(await r.arrayBuffer())), title: decodeURIComponent(url.split("/").pop().split("?")[0]), kind: "pdf", url };
  }
  const { text } = await proxyText(url);
  const res = htmlToText(text, new URL(url).hostname);
  if (res.text.length < 80) throw new Error("На странице не нашлось текста (возможно, нужен вход или это приложение на JS)");
  return { ...res, kind: "url", url };
}
export async function fromPdf(buf) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error("Модуль PDF не загрузился");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 400); i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    let line = "", out = [], lastY = null;
    for (const it of c.items) { const y = it.transform?.[5]; if (lastY !== null && Math.abs(y - lastY) > 4) { out.push(line); line = ""; } line += it.str; lastY = y; }
    out.push(line);
    pages.push(`[стр. ${i}]\n` + out.join("\n").replace(/\n{3,}/g, "\n\n"));
  }
  return { text: pages.join("\n\n"), pages: pdf.numPages };
}
export async function fromFile(file) {
  const name = file.name, ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") return { ...(await fromPdf(await file.arrayBuffer())), title: name, kind: "pdf" };
  if (ext === "docx") {
    if (!window.mammoth) throw new Error("Модуль DOCX не загрузился");
    const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { title: name, text: r.value, kind: "doc" };
  }
  if (["html", "htm"].includes(ext)) return { ...htmlToText(await file.text(), name), title: name, kind: "doc" };
  if (["txt", "md", "csv", "json", "srt", "vtt", "xml", "rtf", "log"].includes(ext) || file.type.startsWith("text/")) return { title: name, text: await file.text(), kind: "text" };
  throw new Error(`Формат .${ext} пока не поддерживается (PDF, DOCX, TXT, MD, HTML, CSV)`);
}
