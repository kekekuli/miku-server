import { connect } from 'cloudflare:sockets';

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
const TYPE_RESPONSE = 0;
const TIMEOUT_MS = 5000;

function buildPacket(id: number, type: number, body: string): Uint8Array {
  const bodyBytes = new TextEncoder().encode(body);
  // packet = [size:4][id:4][type:4][body][0x00][0x00]
  const size = 4 + 4 + bodyBytes.length + 2;
  const buf = new Uint8Array(4 + size);
  const dv = new DataView(buf.buffer);
  dv.setInt32(0, size, true);
  dv.setInt32(4, id, true);
  dv.setInt32(8, type, true);
  buf.set(bodyBytes, 12);
  return buf; // remaining bytes are already 0x00
}

class PacketReader {
  private buf = new Uint8Array(0);

  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async readChunk(): Promise<Uint8Array> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RCON timeout')), TIMEOUT_MS)
    );
    const result = await Promise.race([this.reader.read(), timeout]);
    if (result.done) throw new Error('RCON connection closed unexpectedly');
    return result.value;
  }

  private async ensureBytes(n: number): Promise<void> {
    while (this.buf.length < n) {
      const chunk = await this.readChunk();
      const next = new Uint8Array(this.buf.length + chunk.length);
      next.set(this.buf);
      next.set(chunk, this.buf.length);
      this.buf = next;
    }
  }

  async readPacket(): Promise<{ id: number; type: number; body: string }> {
    await this.ensureBytes(4);
    const size = new DataView(this.buf.buffer).getInt32(0, true);

    await this.ensureBytes(4 + size);
    const dv = new DataView(this.buf.buffer);
    const id = dv.getInt32(4, true);
    const type = dv.getInt32(8, true);
    // body is between offset 12 and (4 + size - 2), stripping two trailing null bytes
    const body = new TextDecoder().decode(this.buf.slice(12, 4 + size - 2));

    this.buf = this.buf.slice(4 + size);
    return { id, type, body };
  }
}

export async function sendRconCommand(
  host: string,
  port: number,
  password: string,
  command: string,
): Promise<string> {
  const socket = connect({ hostname: host, port });
  const writer = socket.writable.getWriter();
  const reader = new PacketReader(socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>);

  try {
    // Auth
    await writer.write(buildPacket(1, TYPE_AUTH, password));

    // Server sends an empty RESPONSE_VALUE then an AUTH_RESPONSE
    // AUTH_RESPONSE id === -1 means bad password
    let authed = false;
    for (let i = 0; i < 3 && !authed; i++) {
      const p = await reader.readPacket();
      if (p.type === TYPE_EXEC) { // AUTH_RESPONSE shares type value 2 with EXEC
        if (p.id === -1) throw new Error('RCON authentication failed — wrong password');
        authed = true;
      }
    }
    if (!authed) throw new Error('RCON auth response not received');

    // Send command (id=2) then a dummy empty command (id=3)
    // Collect all RESPONSE_VALUE packets for id=2 until we see id=3 response
    await writer.write(buildPacket(2, TYPE_EXEC, command));
    await writer.write(buildPacket(3, TYPE_EXEC, ''));

    const parts: string[] = [];
    while (true) {
      const p = await reader.readPacket();
      if (p.type !== TYPE_RESPONSE) continue;
      if (p.id === 3) break; // dummy response signals end
      if (p.id === 2) parts.push(p.body);
    }

    return parts.join('');
  } finally {
    writer.releaseLock();
    await socket.close();
  }
}
