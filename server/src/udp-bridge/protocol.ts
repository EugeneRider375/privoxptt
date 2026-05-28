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

export function buildAuthOk(): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(MAGIC_AUTH_OK, 0);
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

export function buildAudioPacket(seq: number, pcm: Buffer): Buffer {
  const b = Buffer.alloc(6 + pcm.length);
  b.writeUInt16LE(MAGIC_AUDIO, 0);
  b.writeUInt16LE(seq & 0xffff, 2);
  b.writeUInt16LE(pcm.length >>> 1, 4); // sample count
  pcm.copy(b, 6);
  return b;
}
