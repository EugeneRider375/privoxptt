// PCM ↔ Opus conversion and RTP framing for the UDP bridge.
//
// ESP32 sends:  PCM int16 LE, 16 kHz, mono
// MediaSoup:   Opus, 48 kHz, stereo  (clockRate = 48000)
//
// Strategy: upsample 16k→48k + mono→stereo before encoding,
//           downsample + mix after decoding. No native build needed (opusscript = WASM).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript') as {
  new (sampleRate: number, channels: number, application?: number): OpusScriptInstance;
  Application: { VOIP: number; AUDIO: number };
};

interface OpusScriptInstance {
  encode(pcm: Buffer, frameSize: number): Buffer;
  decode(opus: Buffer, frameSize: number): Buffer;
}

export const ESP32_SAMPLE_RATE  = 16_000;
export const MS_SAMPLE_RATE     = 48_000;
export const MS_CHANNELS        = 2;
export const FRAME_MS           = 20;

// Samples per 20 ms frame at each rate
export const ESP32_FRAME_SAMPLES = (ESP32_SAMPLE_RATE * FRAME_MS) / 1000; // 320
export const MS_FRAME_SAMPLES    = (MS_SAMPLE_RATE   * FRAME_MS) / 1000; // 960

// RTP constants
export const RTP_PAYLOAD_TYPE       = 100;
export const RTP_CLOCK_RATE         = MS_SAMPLE_RATE;
export const RTP_TIMESTAMP_PER_FRAME = MS_FRAME_SAMPLES; // 960

const encoder = new OpusScript(MS_SAMPLE_RATE, MS_CHANNELS, OpusScript.Application.VOIP);
const decoder = new OpusScript(MS_SAMPLE_RATE, MS_CHANNELS);

// ─── Resampling helpers ───────────────────────────────────────────────────────

/** Upsample 16 kHz mono int16 → 48 kHz stereo int16 (linear interpolation × 3). */
export function upsample16MonoTo48Stereo(buf: Buffer): Buffer {
  const n   = buf.length >>> 1; // number of mono samples
  const out = Buffer.alloc(n * 3 * 4); // 3× samples, 2 channels, 2 bytes each
  for (let i = 0; i < n; i++) {
    const s0  = buf.readInt16LE(i * 2);
    const s1  = i + 1 < n ? buf.readInt16LE((i + 1) * 2) : s0;
    for (let j = 0; j < 3; j++) {
      const s   = Math.round(s0 + ((s1 - s0) * j) / 3);
      const off = (i * 3 + j) * 4;
      out.writeInt16LE(s, off);     // L
      out.writeInt16LE(s, off + 2); // R (same as L for mono source)
    }
  }
  return out;
}

/** Downsample 48 kHz stereo int16 → 16 kHz mono int16 (drop 2 out of 3 + L+R average). */
export function downsample48StereoTo16Mono(buf: Buffer): Buffer {
  const stereoSamples = buf.length >>> 2; // 4 bytes per stereo sample
  const outSamples    = Math.floor(stereoSamples / 3);
  const out           = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const src  = i * 3 * 4;
    const l    = buf.readInt16LE(src);
    const r    = buf.readInt16LE(src + 2);
    const mono = Math.round((l + r) / 2);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, mono)), i * 2);
  }
  return out;
}

// ─── Codec ───────────────────────────────────────────────────────────────────

/** Encode 16 kHz mono PCM frame → Opus payload (no RTP header). */
export function encodePcmToOpus(pcm16Mono: Buffer): Buffer {
  const pcm48 = upsample16MonoTo48Stereo(pcm16Mono);
  return encoder.encode(pcm48, MS_FRAME_SAMPLES);
}

/** Decode Opus payload (no RTP header) → 16 kHz mono PCM. */
export function decodeOpusToPcm(opusPayload: Buffer): Buffer {
  const pcm48Stereo = decoder.decode(opusPayload, MS_FRAME_SAMPLES);
  return downsample48StereoTo16Mono(pcm48Stereo);
}

// ─── RTP ─────────────────────────────────────────────────────────────────────

export function buildRtpPacket(
  payload: Buffer,
  ssrc: number,
  seq: number,
  timestamp: number,
): Buffer {
  const hdr = Buffer.alloc(12);
  hdr[0] = 0x80; // V=2, P=0, X=0, CC=0
  hdr[1] = RTP_PAYLOAD_TYPE & 0x7f;
  hdr.writeUInt16BE(seq & 0xffff, 2);
  hdr.writeUInt32BE(timestamp >>> 0, 4);
  hdr.writeUInt32BE(ssrc >>> 0, 8);
  return Buffer.concat([hdr, payload]);
}

/** Returns byte offset of RTP payload (skips fixed + extension headers), or -1 on error. */
export function getRtpPayloadOffset(pkt: Buffer): number {
  if (pkt.length < 12) return -1;
  const cc  = pkt[0] & 0x0f;
  let   off = 12 + cc * 4;
  if ((pkt[0] & 0x10) !== 0) { // extension present
    if (pkt.length < off + 4) return -1;
    const extLen = pkt.readUInt16BE(off + 2);
    off += 4 + extLen * 4;
  }
  return off > pkt.length ? -1 : off;
}
