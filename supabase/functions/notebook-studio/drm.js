// Порт edge_tts/drm.py (edge-tts 7.3.1): токен Sec-MS-GEC v2 для голосов Microsoft Edge.
// Вся арифметика в BigInt, чтобы повторить поведение Python-целых без потери битов.
const M = 0xFFFFFFFFn;
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const SEC_MS_GEC_VERSION = "2-143.0.3650.75";
export const TOKEN = TRUSTED_CLIENT_TOKEN;
const B = (a) => a.map((x) => BigInt(x));
const SHA_INIT = B([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]);
const SHA_STATE = B([0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2]);
const SHA_SCHED = B([0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564]);
const K = B([0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2]);
const ADJ = 0xC9DC06A7n;
const KB = [...K.slice(0, 14), ADJ, ...K.slice(15)];
const SIG0_ADJ = 0x059C0B80n, SIG1_ADJ = 0x000B92C0n;
const CS64_COEF = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]].map(([a, b]) => [BigInt(a), BigInt(b)]);
const CS64_FACTOR = 0x82893933n, CS64_ADJ0 = 0xF2F90B1An, CS64_ADJ1 = 0x0B1A0000n;

const rol16 = (v) => { v &= M; return ((v << 16n) | (v >> 16n)) & M; };
const sigma0 = (v) => ((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & M;
const sigma1 = (v) => ((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & M;
const R = 0x100000001n;
const S1 = (e) => { const r = e * R; return (r >> 6n) ^ (r >> 11n) ^ (r >> 25n); };
const S0 = (a) => { const r = a * R; return (r >> 2n) ^ (r >> 13n) ^ (r >> 22n); };

function rounds(state, words, first = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const consts = first === 14 ? KB : K;
  // Python делает раскрутку по 8, но результат эквивалентен обычному циклу.
  for (let i = first; i < 64; i++) {
    const t1 = h + S1(e) + (g ^ (e & (f ^ g))) + consts[i] + words[i];
    const t2 = S0(a) + ((a & b) | (c & (a | b)));
    h = g; g = f; f = e; e = (d + t1) & M; d = c; c = b; b = a; a = (t1 + t2) & M;
  }
  return [a, b, c, d, e, f, g, h];
}
function expand(words, first = 16) {
  for (let i = first; i < 64; i++) {
    const x = words[i - 2], y = words[i - 15];
    const s1 = (x >> 17n) ^ (x << 15n) ^ (x >> 19n) ^ (x << 13n) ^ (x >> 10n);
    const s0 = (y >> 7n) ^ (y << 25n) ^ (y >> 18n) ^ (y << 14n) ^ (y >> 3n);
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) & M);
  }
}
const beInt = (bytes) => bytes.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
function shaInit(data) {
  const w = new Array(14).fill(0n);
  w.push(beInt(data.slice(0, 3)));
  w.push(beInt(data.slice(3, 7)));
  for (let i = 16; i < 30; i++) {
    let v = SHA_SCHED[i - 16];
    if (i - 2 >= 14) v += i === 16 ? (sigma1(w[i - 2]) ^ SIG1_ADJ) : sigma1(w[i - 2]);
    if (i - 7 >= 14) v += w[i - 7];
    if (i - 15 >= 14) v += i === 29 ? (sigma0(w[i - 15]) ^ SIG0_ADJ) : sigma0(w[i - 15]);
    w.push(v & M);
  }
  w.push((sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + ADJ - K[14]) & M);
  expand(w, 31);
  const wk = rounds(SHA_STATE, w, 14);
  return SHA_INIT.map((x, i) => (x + wk[i]) & M);
}
function sha256(data) {
  const length = 57 + data.length;
  const padLen = (((55 - length) % 64) + 64) % 64;
  const padded = [...data.slice(7), 0x80, ...new Array(padLen).fill(0)];
  let bits = BigInt(length * 8);
  const lenBytes = [];
  for (let i = 0; i < 8; i++) { lenBytes.unshift(Number(bits & 0xFFn)); bits >>= 8n; }
  padded.push(...lenBytes);
  let state = shaInit(data.slice(0, 7));
  for (let off = 0; off < padded.length; off += 64) {
    const words = [];
    for (let j = 0; j < 16; j++) words.push(beInt(padded.slice(off + j * 4, off + j * 4 + 4)));
    expand(words);
    const wk = rounds(state, words);
    state = state.map((x, i) => (x + wk[i]) & M);
  }
  return state; // 8 BigInt слов (big-endian)
}
function leWordsEven(bytes) {
  const p = [...bytes]; while (p.length % 4) p.push(0);
  const w = [];
  for (let i = 0; i < p.length; i += 4) w.push(BigInt(p[i]) | (BigInt(p[i + 1]) << 8n) | (BigInt(p[i + 2]) << 16n) | (BigInt(p[i + 3]) << 24n));
  if (w.length % 2) w.push(0n);
  return w;
}
const bswap = (v) => ((v & 0xFFn) << 24n) | (((v >> 8n) & 0xFFn) << 16n) | (((v >> 16n) & 0xFFn) << 8n) | ((v >> 24n) & 0xFFn);
function cs64(data, digestWords) {
  // struct.unpack_from("<II", digest): первые 8 байт дайджеста как little-endian
  let keyA = bswap(digestWords[0]) | 1n, keyB = bswap(digestWords[1]) | 1n;
  const factors = [(keyA * CS64_FACTOR) & M, (keyB * CS64_FACTOR) & M];
  const terms = CS64_COEF.map(([c], i) => (c * factors[i % 2]) & M);
  const offsets = CS64_COEF.map(([, o]) => o);
  leWordsEven([0, ...data]).forEach((word, i) => {
    let term = word * (i % 2 === 0 ? keyA : keyB);
    let off = rol16(word) * (i % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn);
    if (i === 0) { term += CS64_ADJ0 * factors[0]; off += CS64_ADJ1; }
    terms.push(term & M); offsets.push(off & M);
  });
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16((offsets[i] + x) & M);
    let q = (t * 0x76F50F34n) & M;
    swapAcc += (rol16(q) * 0xC3EFEA97n + q) & M;
    t = rol16((offsets[i + 1] + y) & M);
    q = (t * 0x1881CE3Cn) & M;
    swapLast = (rol16(q) * 0x35BD1EC9n + q) & M;
    swapAcc = (swapAcc + swapLast) & M;
    state = (state * keyA + x) & M;
    state = (rol16(state) * 0xCF98B111n) & M;
    state = (rol16(state) * 0x87085B9Fn) & M;
    state = (rol16(state) * 0x12CEB96Dn) & M;
    state = (rol16(state) * 0x257E1D83n) & M;
    acc += state;
    t = (state * keyB + y) & M;
    t = (rol16(t) * 0xA27416F5n) & M;
    t = (rol16(t) * 0xD38396FFn) & M;
    state = (rol16((rol16(t) * 0x7C932B89n) & M) * 0xBFA49F69n) & M;
    acc = (acc + state) & M;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}
const hex8 = (v) => v.toString(16).padStart(8, "0").toUpperCase();
export function secMsGec(unixSeconds = Date.now() / 1000) {
  let ticks = unixSeconds + 11644473600;
  ticks -= ticks % 300;
  const t = BigInt(Math.round(ticks)) * 10000000n;
  const data = [...new TextEncoder().encode(`${t}${TRUSTED_CLIENT_TOKEN}`)];
  const dg = sha256(data);
  const [c0, c1] = cs64(data, dg);
  const cs = hex8(bswap(c0)) + hex8(bswap(c1)); // pack("<II").hex()
  return `${cs}-${dg.map(hex8).join("")}`;
}
