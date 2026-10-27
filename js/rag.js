// Поиск по источникам: нарезка на фрагменты + BM25 с грубым стеммингом (рус/англ).
const STOP = new Set("и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между the a an of to and in is it for on with as by at be this that are from or".split(" "));
export function tokens(s) {
  return (String(s).toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => (w.length > 6 ? w.slice(0, w.length > 9 ? 7 : 6) : w));
}
export function chunk(text, size = 900, overlap = 150) {
  const paras = String(text).replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out = []; let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { out.push(cur); cur = cur.slice(-overlap) + "\n\n" + p; }
    else cur = cur ? cur + "\n\n" + p : p;
    while (cur.length > size * 1.6) { out.push(cur.slice(0, size)); cur = cur.slice(size - overlap); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}
export function search(sources, query, k = 8) {
  const docs = [];
  for (const s of sources) (s.chunks || []).forEach((c, i) => docs.push({ src: s, i, text: c, tk: tokens(c) }));
  if (!docs.length) return [];
  const q = [...new Set(tokens(query))];
  const N = docs.length, avg = docs.reduce((a, d) => a + d.tk.length, 0) / N;
  const df = {}; for (const d of docs) for (const t of new Set(d.tk)) df[t] = (df[t] || 0) + 1;
  for (const d of docs) {
    const tf = {}; for (const t of d.tk) tf[t] = (tf[t] || 0) + 1;
    let s = 0;
    for (const t of q) if (tf[t]) { const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5)); s += idf * (tf[t] * 2.2) / (tf[t] + 1.2 * (0.25 + 0.75 * d.tk.length / avg)); }
    d.score = s + (d.i === 0 ? 0.05 : 0);
  }
  const ranked = docs.sort((a, b) => b.score - a.score);
  const top = ranked.filter((d) => d.score > 0).slice(0, k);
  return top.length ? top : ranked.slice(0, Math.min(k, 4));
}
// Сжатое содержимое всех источников (для обзоров/рилсов) в пределах бюджета символов.
export function digest(sources, budget = 24000) {
  const per = Math.max(1500, Math.floor(budget / Math.max(1, sources.length)));
  return sources.map((s, n) => `### Источник ${n + 1}: ${s.title}\n${s.text.length > per ? s.text.slice(0, per * 0.7) + "\n…\n" + s.text.slice(-per * 0.3) : s.text}`).join("\n\n").slice(0, budget);
}
