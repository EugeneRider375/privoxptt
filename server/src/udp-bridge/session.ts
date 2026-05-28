import dgram from 'dgram';
import type { Server } from 'socket.io';
import type { PlainTransport, Producer, Consumer } from 'mediasoup/node/lib/types';
import { mediasoupManager } from '../mediasoup/server';
import { groupProducerEvents, getGroupProducers } from '../mediasoup/router';
import { acquirePttLock, releasePttLock } from '../database/redis';
import { logger } from '../utils/logger';
import {
  encodePcmToOpus,
  decodeOpusToPcm,
  buildRtpPacket,
  getRtpPayloadOffset,
  ESP32_FRAME_SAMPLES,
  RTP_PAYLOAD_TYPE,
  RTP_TIMESTAMP_PER_FRAME,
} from './codec';
import { buildAudioPacket, buildPong } from './protocol';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS  = 30_000;

let ssrcCounter = 0xAB120001;

export class DeviceSession {
  private txTransport: PlainTransport | null = null;
  private rxTransport: PlainTransport | null = null;
  private txSocket: dgram.Socket | null = null;
  private rxSocket: dgram.Socket | null = null;
  private producer: Producer | null = null;
  private consumers = new Map<string, Consumer>(); // producerId → Consumer

  private pcmBuffer   = Buffer.alloc(0);
  private rtpSeq      = 0;
  private rtpTs       = 0;
  private txSeqOut    = 0;
  private lastPong    = Date.now();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private closed      = false;

  readonly ssrc: number;

  constructor(
    public readonly userId:   string,
    public readonly callsign: string,
    public readonly groupId:  string,
    private readonly sendToDevice: (buf: Buffer) => void,
    private readonly io: Server,
    private readonly onDisconnect: () => void,
  ) {
    this.ssrc = (ssrcCounter++ >>> 0);
  }

  async init(): Promise<void> {
    const router = await mediasoupManager.getOrCreateGroupRouter(this.groupId);

    // ── TX: bridge → mediasoup ────────────────────────────────
    this.txTransport = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' },
      rtcpMux: true,
      comedia: true,
    });
    const txPort = this.txTransport.tuple.localPort;

    this.txSocket = dgram.createSocket('udp4');
    await new Promise<void>((res, rej) =>
      this.txSocket!.bind(0, '127.0.0.1', (err?: Error) => err ? rej(err) : res())
    );

    this.producer = await this.txTransport.produce({
      kind: 'audio',
      rtpParameters: {
        codecs: [{
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          payloadType: RTP_PAYLOAD_TYPE,
          parameters: { 'sprop-stereo': 1 },
        }],
        encodings: [{ ssrc: this.ssrc }],
      },
    });

    logger.info({
      msg: 'ESP32 producer created',
      userId: this.userId,
      producerId: this.producer.id,
      groupId: this.groupId,
      txPort,
    });

    // ── RX: mediasoup → bridge ────────────────────────────────
    this.rxSocket = dgram.createSocket('udp4');
    await new Promise<void>((res, rej) =>
      this.rxSocket!.bind(0, '127.0.0.1', (err?: Error) => err ? rej(err) : res())
    );
    const rxPort = (this.rxSocket.address() as dgram.AddressInfo).port;

    this.rxTransport = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' },
      rtcpMux: true,
      comedia: false,
    });
    await this.rxTransport.connect({ ip: '127.0.0.1', port: rxPort });

    this.rxSocket.on('message', (msg) => this.onRtpFromMediasoup(msg));

    // Subscribe to existing producers in the group
    const existing = getGroupProducers(this.groupId);
    for (const { producerId } of existing) {
      if (producerId !== this.producer.id) {
        await this.subscribeToProducer(producerId).catch((err) =>
          logger.warn({ msg: 'Failed to subscribe to existing producer', err, producerId })
        );
      }
    }

    // Subscribe to future producers
    groupProducerEvents.on('producer-created', this.onProducerCreated);
    groupProducerEvents.on('producer-closed',  this.onProducerClosed);

    // Heartbeat watchdog
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.lastPong = Date.now();

    logger.info({ msg: 'DeviceSession ready', userId: this.userId, groupId: this.groupId });
  }

  // ── Producer events ───────────────────────────────────────
  private onProducerCreated = async (groupId: string, producerId: string) => {
    if (groupId !== this.groupId) return;
    if (producerId === this.producer?.id) return;
    await this.subscribeToProducer(producerId).catch((err) =>
      logger.warn({ msg: 'Failed to subscribe to new producer', err, producerId })
    );
  };

  private onProducerClosed = (_groupId: string, producerId: string) => {
    if (_groupId !== this.groupId) return;
    const consumer = this.consumers.get(producerId);
    if (consumer && !consumer.closed) consumer.close();
    this.consumers.delete(producerId);
  };

  private async subscribeToProducer(producerId: string): Promise<void> {
    if (!this.rxTransport || this.rxTransport.closed) return;
    const router = mediasoupManager.getGroupRouter(this.groupId);
    if (!router) return;

    const consumer = await this.rxTransport.consume({
      producerId,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    consumer.on('producerclose', () => this.consumers.delete(producerId));
    consumer.on('transportclose', () => this.consumers.delete(producerId));

    this.consumers.set(producerId, consumer);
    logger.debug({ msg: 'ESP32 consumer created', userId: this.userId, producerId });
  }

  // ── PTT ───────────────────────────────────────────────────
  async onPttStart(): Promise<void> {
    const acquired = await acquirePttLock(this.groupId, this.userId);
    if (!acquired) return;

    this.io.to(this.groupId).emit('channel-busy', {
      groupId: this.groupId,
      userId: this.userId,
      callsign: this.callsign,
      displayName: this.callsign,
    });

    // Pause RX during TX (half-duplex)
    for (const c of this.consumers.values()) {
      if (!c.paused && !c.closed) c.pause();
    }

    logger.info({ msg: 'ESP32 PTT start', userId: this.userId, groupId: this.groupId });
  }

  async onPttStop(): Promise<void> {
    const released = await releasePttLock(this.groupId, this.userId);
    if (released) {
      this.io.to(this.groupId).emit('channel-free', { groupId: this.groupId });
    }

    // Flush PCM accumulation buffer
    this.pcmBuffer = Buffer.alloc(0);

    // Resume RX
    for (const c of this.consumers.values()) {
      if (c.paused && !c.closed) c.resume().catch(() => {});
    }

    logger.info({ msg: 'ESP32 PTT stop', userId: this.userId, groupId: this.groupId });
  }

  // ── Audio from ESP32 ──────────────────────────────────────
  onAudio(pcm: Buffer): void {
    if (!this.txSocket || !this.txTransport || this.txTransport.closed) return;

    this.pcmBuffer = Buffer.concat([this.pcmBuffer, pcm]);
    const frameBytes = ESP32_FRAME_SAMPLES * 2;

    while (this.pcmBuffer.length >= frameBytes) {
      const frame    = this.pcmBuffer.subarray(0, frameBytes);
      this.pcmBuffer = this.pcmBuffer.subarray(frameBytes);

      try {
        const opus = encodePcmToOpus(frame);
        const rtp  = buildRtpPacket(opus, this.ssrc, this.rtpSeq++, this.rtpTs);
        this.rtpTs = (this.rtpTs + RTP_TIMESTAMP_PER_FRAME) >>> 0;
        this.txSocket.send(rtp, this.txTransport.tuple.localPort, '127.0.0.1');
      } catch (err) {
        logger.warn({ msg: 'ESP32 encode error', err });
      }
    }
  }

  // ── Audio from MediaSoup → ESP32 ──────────────────────────
  private onRtpFromMediasoup(pkt: Buffer): void {
    const off = getRtpPayloadOffset(pkt);
    if (off < 0 || off >= pkt.length) return;

    const opusPayload = pkt.subarray(off);
    try {
      const pcm16 = decodeOpusToPcm(opusPayload);
      if (pcm16.length > 0) {
        this.sendToDevice(buildAudioPacket(this.txSeqOut++ & 0xffff, pcm16));
      }
    } catch {
      // Packet may be malformed — ignore
    }
  }

  // ── Ping / pong ───────────────────────────────────────────
  onPing(): void {
    this.sendToDevice(buildPong());
  }

  onPong(): void {
    this.lastPong = Date.now();
  }

  private checkHeartbeat(): void {
    if (Date.now() - this.lastPong > HEARTBEAT_TIMEOUT_MS) {
      logger.warn({ msg: 'ESP32 heartbeat timeout', userId: this.userId });
      void this.close();
      this.onDisconnect();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    groupProducerEvents.off('producer-created', this.onProducerCreated);
    groupProducerEvents.off('producer-closed',  this.onProducerClosed);

    await releasePttLock(this.groupId, this.userId).catch(() => {});

    for (const c of this.consumers.values()) {
      if (!c.closed) c.close();
    }
    this.consumers.clear();

    if (this.producer && !this.producer.closed) this.producer.close();
    if (this.txTransport && !this.txTransport.closed) this.txTransport.close();
    if (this.rxTransport && !this.rxTransport.closed) this.rxTransport.close();

    this.txSocket?.close();
    this.rxSocket?.close();

    logger.info({ msg: 'DeviceSession closed', userId: this.userId });
  }
}
