// Минимальный WebSocket-клиент поверх TLS (нужен, чтобы передать свои заголовки — стандартный WebSocket этого не умеет).
export type WsMsg = { text?: string; binary?: Uint8Array };
export class RawWs {
  private conn!: Deno.TlsConn;
  private buf = new Uint8Array(0);
  private enc = new TextEncoder();
  private dec = new TextDecoder();
  static async connect(url: string, headers: Record<string, string>): Promise<RawWs> {
    const u = new URL(url);
    const ws = new RawWs();
    ws.conn = await Deno.connectTls({ hostname: u.hostname, port: +(u.port || 443), alpnProtocols: ["http/1.1"] });
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    let req = `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n`;
    for (const [k, v] of Object.entries(headers)) req += `${k}: ${v}\r\n`;
    req += "\r\n";
    await ws.writeAll(ws.enc.encode(req));
    // читаем ответ до \r\n\r\n
    while (true) {
      const i = ws.indexOfCRLF2();
      if (i >= 0) {
        const head = ws.dec.decode(ws.buf.subarray(0, i));
        ws.buf = ws.buf.slice(i + 4);
        if (!/^HTTP\/1\.1 101/.test(head)) { try { ws.conn.close(); } catch (_) { /**/ } throw new Error("ws handshake: " + head.split("\r\n")[0]); }
        return ws;
      }
      if (!(await ws.fill())) throw new Error("ws handshake: connection closed");
    }
  }
  private indexOfCRLF2() {
    for (let i = 0; i + 3 < this.buf.length; i++) if (this.buf[i] === 13 && this.buf[i + 1] === 10 && this.buf[i + 2] === 13 && this.buf[i + 3] === 10) return i;
    return -1;
  }
  private async fill(): Promise<boolean> {
    const chunk = new Uint8Array(65536);
    const n = await this.conn.read(chunk);
    if (n === null) return false;
    const nb = new Uint8Array(this.buf.length + n); nb.set(this.buf); nb.set(chunk.subarray(0, n), this.buf.length); this.buf = nb;
    return true;
  }
  private async need(n: number) { while (this.buf.length < n) if (!(await this.fill())) throw new Error("ws closed"); }
  private async writeAll(data: Uint8Array) { let o = 0; while (o < data.length) o += await this.conn.write(data.subarray(o)); }
  async sendFrame(opcode: number, payload: Uint8Array) {
    const len = payload.length;
    const head: number[] = [0x80 | opcode];
    if (len < 126) head.push(0x80 | len);
    else if (len < 65536) head.push(0x80 | 126, len >> 8, len & 255);
    else { head.push(0x80 | 127, 0, 0, 0, 0, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255); }
    const mask = crypto.getRandomValues(new Uint8Array(4));
    const out = new Uint8Array(head.length + 4 + len);
    out.set(head); out.set(mask, head.length);
    for (let i = 0; i < len; i++) out[head.length + 4 + i] = payload[i] ^ mask[i & 3];
    await this.writeAll(out);
  }
  sendText(s: string) { return this.sendFrame(1, this.enc.encode(s)); }
  async recv(): Promise<WsMsg | null> {
    let parts: Uint8Array[] = []; let type = 0;
    while (true) {
      await this.need(2);
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 127, off = 2;
      if (len === 126) { await this.need(4); len = (this.buf[2] << 8) | this.buf[3]; off = 4; }
      else if (len === 127) { await this.need(10); len = 0; for (let i = 6; i < 10; i++) len = len * 256 + this.buf[i]; off = 10; }
      const masked = (b1 & 128) !== 0; if (masked) off += 4;
      await this.need(off + len);
      let payload = this.buf.slice(off, off + len);
      if (masked) { const m = this.buf.slice(off - 4, off); payload = payload.map((x, i) => x ^ m[i & 3]); }
      this.buf = this.buf.slice(off + len);
      const op = b0 & 15, fin = (b0 & 128) !== 0;
      if (op === 8) return null;
      if (op === 9) { await this.sendFrame(10, payload); continue; }
      if (op === 10) continue;
      if (op !== 0) { type = op; parts = []; }
      parts.push(payload);
      if (fin) {
        const total = parts.reduce((a, p) => a + p.length, 0); const all = new Uint8Array(total); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        return type === 1 ? { text: this.dec.decode(all) } : { binary: all };
      }
    }
  }
  close() { try { this.sendFrame(8, new Uint8Array(0)).catch(() => {}); this.conn.close(); } catch (_) { /**/ } }
}
