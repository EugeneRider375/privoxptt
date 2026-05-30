// UDP protocol between ESP32 and bridge
// All multi-byte fields: little-endian

export const MAGIC_AUDIO      = 0xAB12; // PCM audio packet (existing)
export const MAGIC_AUTH       = 0xAB13; // AUTH_REQ: email\0password\0groupId\0
export const MAGIC_AUTH_OK    = 0xAB14;
export const MAGIC_AUTH_FAIL  = 0xAB15; // followed by error string
export const MAGIC_PTT_START  = 0xAB16;
export const MAGIC_PTT_STOP   = 0xAB17;
export const MAGIC_PING       = 0xAB18;
export const MAGIC_PONG       = 0xAB19;
export const MAGIC_CALL       = 0xAB1A; // server→device: callerName\0 groupName\0

export type Packet =
  | { type: 'audio';    seq: number; samples: number; pcm: Buffer }
  | { type: 'auth';     email: string; password: string; groupId: string }
  | { type: 'ptt_start' }
  | { type: 'ptt_stop' }
  | { type: 'ping' }
  | { type: 'pong' };

export function parsePacket(buf: Buffer): Packet | null {
  if (buf.length < 2) return null;
  const magic = buf.readUInt16LE(0);

  switch (magic) {
    case MAGIC_AUDIO: {
      if (buf.length < 6) return null;
      const seq     = buf.readUInt16LE(2);
      const samples = buf.readUInt16LE(4);
      const pcm     = buf.subarray(6);
      return { type: 'audio', seq, samples, pcm };
    }
    case MAGIC_AUTH: {
      const parts = buf.subarray(2).toString('utf8').split('\0');
      if (parts.length < 3) return null;
      return { type: 'auth', email: parts[0], password: parts[1], groupId: parts[2] };
    }
    case MAGIC_PTT_START: return { type: 'ptt_start' };
    case MAGIC_PTT_STOP:  return { type: 'ptt_stop' };
    case MAGIC_PING:      return { type: 'ping' };
    case MAGIC_PONG:      return { type: 'pong' };
    default:              return null;
  }
}

// AUTH_OK payload (backward compatible — old firmware reads only the 2-byte magic):
//   magic(2 LE) | count(1) | repeat count times: groupId\0 name\0
// Group names are capped to keep the packet small and display-friendly.
export function buildAuthOk(groups: { id: string; name: string }[] = []): Buffer {
  const capped = groups.slice(0, 16); // hard cap to bound packet size
  const parts: Buffer[] = [];
  for (const g of capped) {
    const name = g.name.length > 20 ? g.name.slice(0, 20) : g.name;
    parts.push(Buffer.from(`${g.id}\0${name}\0`, 'utf8'));
  }
  const body = Buffer.concat(parts);
  const b = Buffer.alloc(3 + body.length);
  b.writeUInt16LE(MAGIC_AUTH_OK, 0);
  b.writeUInt8(capped.length, 2);
  body.copy(b, 3);
  return b;
}

export function buildAuthFail(msg: string): Buffer {
  const mb = Buffer.from(msg + '\0', 'utf8');
  const b  = Buffer.alloc(2 + mb.length);
  b.writeUInt16LE(MAGIC_AUTH_FAIL, 0);
  mb.copy(b, 2);
  return b;
}

export function buildPong(): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(MAGIC_PONG, 0);
  return b;
}

// Входящий вызов на рацию: magic | callerName\0 groupName\0
export function buildCallPacket(callerName: string, groupName: string): Buffer {
  const nm = callerName.length > 22 ? callerName.slice(0, 22) : callerName;
  const gn = groupName.length  > 22 ? groupName.slice(0, 22)  : groupName;
  const body = Buffer.from(`${nm}\0${gn}\0`, 'utf8');
  const b = Buffer.alloc(2 + body.length);
  b.writeUInt16LE(MAGIC_CALL, 0);
  body.copy(b, 2);
  return b;
}

export function buildAudioPacket(seq: number, pcm: Buffer): Buffer {
  const b = Buffer.alloc(6 + pcm.length);
  b.writeUInt16LE(MAGIC_AUDIO, 0);
  b.writeUInt16LE(seq & 0xffff, 2);
  b.writeUInt16LE(pcm.length >>> 1, 4); // sample count
  pcm.copy(b, 6);
  return b;
}
