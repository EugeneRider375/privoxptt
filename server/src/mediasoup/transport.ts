import type {
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  DtlsParameters,
  RtpParameters,
  RtpCapabilities,
  IceCandidate,
  IceParameters,
  DtlsState,
} from 'mediasoup/node/lib/types';
import { config } from '../config';
import { logger } from '../utils/logger';

// Параметры WebRTC транспорта
const WEBRTC_TRANSPORT_OPTIONS = {
  listenInfos: [
    {
      protocol: 'udp' as const,
      ip: config.MEDIASOUP_LISTEN_IP,
      announcedAddress: config.MEDIASOUP_ANNOUNCED_IP,
    },
    {
      protocol: 'tcp' as const,
      ip: config.MEDIASOUP_LISTEN_IP,
      announcedAddress: config.MEDIASOUP_ANNOUNCED_IP,
    },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  // Ограничение битрейта для аудио PTT
  initialAvailableOutgoingBitrate: 100_000, // 100 Kbps — для аудио более чем достаточно
};

export interface TransportInfo {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

// ─── Менеджер транспортов на сессию ──────────────────────
export class PeerTransportManager {
  private sendTransport: WebRtcTransport | null = null;
  private recvTransport: WebRtcTransport | null = null;
  private producer: Producer | null = null;
  private consumers = new Map<string, Consumer>(); // consumerId → Consumer

  constructor(
    private readonly router: Router,
    private readonly peerId: string,
    public readonly userId: string,
    public readonly callsign: string = '???'
  ) {}

  async createSendTransport(): Promise<TransportInfo> {
    // Закрываем старый producer чтобы очистить SSRC в RTP listener
    if (this.producer && !this.producer.closed) {
      this.producer.close();
      this.producer = null;
    }
    if (this.sendTransport && !this.sendTransport.closed) {
      this.sendTransport.close();
    }

    this.sendTransport = await this.router.createWebRtcTransport(
      WEBRTC_TRANSPORT_OPTIONS
    );

    this.sendTransport.on('dtlsstatechange', (state: DtlsState) => {
      logger.debug({ msg: 'Send transport DTLS state', peerId: this.peerId, state });
    });

    logger.debug({ msg: 'Send transport создан', peerId: this.peerId, id: this.sendTransport.id });

    return {
      id: this.sendTransport.id,
      iceParameters: this.sendTransport.iceParameters,
      iceCandidates: this.sendTransport.iceCandidates,
      dtlsParameters: this.sendTransport.dtlsParameters,
    };
  }

  async createRecvTransport(): Promise<TransportInfo> {
    if (this.recvTransport && !this.recvTransport.closed) {
      this.recvTransport.close();
    }

    this.recvTransport = await this.router.createWebRtcTransport(
      WEBRTC_TRANSPORT_OPTIONS
    );

    this.recvTransport.on('dtlsstatechange', (state: DtlsState) => {
      logger.debug({ msg: 'Recv transport DTLS state', peerId: this.peerId, state });
    });

    logger.debug({ msg: 'Recv transport создан', peerId: this.peerId, id: this.recvTransport.id });

    return {
      id: this.recvTransport.id,
      iceParameters: this.recvTransport.iceParameters,
      iceCandidates: this.recvTransport.iceCandidates,
      dtlsParameters: this.recvTransport.dtlsParameters,
    };
  }

  async connectSendTransport(dtlsParameters: DtlsParameters): Promise<void> {
    if (!this.sendTransport) throw new Error('Send transport was not created');
    await this.sendTransport.connect({ dtlsParameters });
  }

  async connectRecvTransport(dtlsParameters: DtlsParameters): Promise<void> {
    if (!this.recvTransport) throw new Error('Receive transport was not created');
    await this.recvTransport.connect({ dtlsParameters });
  }

  async produce(rtpParameters: RtpParameters): Promise<string> {
    if (!this.sendTransport) throw new Error('Send transport was not created');
    if (this.producer && !this.producer.closed) {
      this.producer.close();
      this.producer = null;
    }
    this.producer = await this.sendTransport.produce({ kind: 'audio', rtpParameters });
    this.producer.on('transportclose', () => { this.producer = null; });
    logger.debug({ msg: 'Producer создан', peerId: this.peerId, producerId: this.producer.id });
    return this.producer.id;
  }

  async consume(
    producerId: string,
    rtpCapabilities: RtpCapabilities
  ): Promise<{ consumerId: string; rtpParameters: RtpParameters }> {
    if (!this.recvTransport) throw new Error('Receive transport was not created');

    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume this producer');
    }

    const consumer = await this.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      this.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      this.consumers.delete(consumer.id);
    });

    logger.debug({ msg: 'Consumer создан (paused)', peerId: this.peerId, consumerId: consumer.id });

    return {
      consumerId: consumer.id,
      rtpParameters: consumer.rtpParameters,
    };
  }

  closeProducer(): void {
    if (this.producer && !this.producer.closed) {
      this.producer.close();
      this.producer = null;
      logger.debug({ msg: 'Producer закрыт клиентом', peerId: this.peerId });
    }
  }

  async resumeConsumer(consumerId: string): Promise<void> {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) throw new Error(`Consumer not found: ${consumerId}`);
    if (!consumer.paused) return;
    await consumer.resume();
    logger.debug({ msg: 'Consumer resumed', peerId: this.peerId, consumerId });
  }

  getProducerId(): string | null {
    return this.producer?.id ?? null;
  }

  close(): void {
    for (const consumer of this.consumers.values()) {
      if (!consumer.closed) consumer.close();
    }
    this.consumers.clear();

    if (this.producer && !this.producer.closed) this.producer.close();
    if (this.sendTransport && !this.sendTransport.closed) this.sendTransport.close();
    if (this.recvTransport && !this.recvTransport.closed) this.recvTransport.close();

    logger.debug({ msg: 'PeerTransportManager закрыт', peerId: this.peerId });
  }
}
