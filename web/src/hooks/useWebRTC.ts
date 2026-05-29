import { useRef, useCallback, useEffect } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import type { Device, Transport, Producer, Consumer } from 'mediasoup-client/types';
import { getPrivoxSocket, PRIVOX_SOCKET_READY_EVENT } from './useSocket';
import { getAudioContext, unlockAudio } from '@/utils/audio';

export { unlockAudio };

// ProducerCodecOptions для Opus — FEC и DTX снижают нагрузку PTT
const OPUS_CODEC_OPTIONS = {
  opusFec: true,
  opusDtx: false, // DTX off: при тишине всё равно шлём пакеты, трек не замьютится
  opusMaxAverageBitrate: 32000,
};

export function useWebRTC(groupId: string | null) {
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producerRef = useRef<Producer | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  // Mutex: предотвращает одновременный запуск двух startTransmitting (quick press-release-press race)
  const isStartingRef = useRef(false);
  // Защита от одновременного создания нескольких recv transport
  const recvTransportCreatingRef = useRef<Promise<void> | null>(null);
  // Уже потребляемые producer'ы — не создавать дубликаты
  const consumedProducersRef = useRef<Set<string>>(new Set());
  const producerCleanupRef = useRef<Map<string, () => void>>(new Map());

  const emit = useCallback(<T>(event: string, data: object): Promise<T> => {
    return new Promise((resolve, reject) => {
      const socket = getPrivoxSocket() ?? (window as any).__privoxSocket;
      if (!socket) { reject(new Error('Socket is not connected')); return; }
      socket.emit(event, data, (resp: T & { error?: string }) => {
        if (resp?.error) reject(new Error(resp.error));
        else resolve(resp);
      });
    });
  }, []);

  const initDevice = useCallback(async () => {
    if (!groupId) return;
    if (!deviceRef.current) deviceRef.current = new mediasoupClient.Device();
    if (deviceRef.current.loaded) return;

    const { rtpCapabilities } = await emit<{ rtpCapabilities: mediasoupClient.types.RtpCapabilities }>(
      'ms:get-rtp-capabilities', { groupId }
    );
    // Проверяем ещё раз после await — cleanup мог обнулить deviceRef
    if (!deviceRef.current) deviceRef.current = new mediasoupClient.Device();
    if (deviceRef.current.loaded) return;
    await deviceRef.current.load({ routerRtpCapabilities: rtpCapabilities });
    console.log('[WebRTC] Device инициализирован');
  }, [groupId, emit]);

  const createSendTransport = useCallback(async () => {
    if (!deviceRef.current || !groupId) throw new Error('Device is not initialized');

    const { transportInfo } = await emit<{ transportInfo: mediasoupClient.types.TransportOptions }>(
      'ms:create-send-transport', { groupId }
    );

    const transport = deviceRef.current.createSendTransport(transportInfo);

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await emit('ms:connect-send-transport', { groupId, dtlsParameters });
        callback();
      } catch (err) { errback(err as Error); }
    });

    transport.on('connectionstatechange', (state) => {
      console.log('[WebRTC] Send ICE state:', state);
      if ((state === 'failed' || state === 'disconnected') && !transport.closed) {
        console.warn('[WebRTC] Send transport ICE failed — закрываем для пересоздания');
        transport.close();
        if (sendTransportRef.current === transport) sendTransportRef.current = null;
      }
    });

    transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
      // Если этот транспорт уже не активный (был заменён или очищен) — игнорируем
      if (sendTransportRef.current !== transport) {
        console.warn('[WebRTC] produce event от устаревшего транспорта — игнорируем');
        errback(new Error('Transport stale'));
        return;
      }
      console.log('[WebRTC] produce event, groupId:', groupId);
      try {
        const { producerId } = await emit<{ producerId: string }>(
          'ms:produce', { groupId, kind, rtpParameters }
        );
        console.log('[WebRTC] ms:produce succeeded, producerId:', producerId);
        callback({ id: producerId });
      } catch (err) {
        console.error('[WebRTC] ms:produce failed:', (err as Error).message);
        errback(err as Error);
      }
    });

    sendTransportRef.current = transport;
    return transport;
  }, [groupId, emit]);

  // Ref чтобы resubscribeAll был доступен внутри createRecvTransport без циклических зависимостей
  const resubscribeAllRef = useRef<(() => void) | null>(null);

  const createRecvTransport = useCallback(async () => {
    if (!deviceRef.current || !groupId) throw new Error('Device is not initialized');

    const { transportInfo } = await emit<{ transportInfo: mediasoupClient.types.TransportOptions }>(
      'ms:create-recv-transport', { groupId }
    );

    const transport = deviceRef.current.createRecvTransport(transportInfo);

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await emit('ms:connect-recv-transport', { groupId, dtlsParameters });
        callback();
      } catch (err) { errback(err as Error); }
    });

    // Таймер для обнаружения зависшего "disconnected" (мобильные сети, LTE↔WiFi)
    let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerRecovery = () => {
      if (transport.closed) return;
      console.warn('[WebRTC] Recv transport recovery triggered');
      transport.close();
      if (recvTransportRef.current === transport) {
        recvTransportRef.current = null;
        // Переподписываемся на всех текущих продюсеров через 1 с
        setTimeout(() => resubscribeAllRef.current?.(), 1000);
      }
    };

    transport.on('connectionstatechange', (state) => {
      console.log('[WebRTC] Recv ICE state:', state);

      if (state === 'disconnected') {
        // Даём 8 секунд на восстановление — если не восстановилось, пересоздаём
        disconnectedTimer = setTimeout(triggerRecovery, 8000);
      } else {
        if (disconnectedTimer) { clearTimeout(disconnectedTimer); disconnectedTimer = null; }
      }

      if (state === 'failed') {
        if (disconnectedTimer) { clearTimeout(disconnectedTimer); disconnectedTimer = null; }
        triggerRecovery();
      }
    });

    recvTransportRef.current = transport;
    return transport;
  }, [groupId, emit]);

  const startTransmitting = useCallback(async (preGrantedStream?: MediaStream) => {
    if (isStartingRef.current) {
      console.log('[WebRTC] startTransmitting уже выполняется — пропускаем');
      return;
    }
    isStartingRef.current = true;
    if (preGrantedStream) {
      streamRef.current = preGrantedStream;
    }
    try {
      console.log('[WebRTC] startTransmitting: шаг 1 — initDevice');
      await initDevice();
      console.log('[WebRTC] startTransmitting: шаг 2 — getUserMedia');
      await unlockAudio();

      const stream = preGrantedStream ?? await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      console.log('[WebRTC] startTransmitting: шаг 3 — createSendTransport');
      // Для PTT надёжнее создавать свежий send transport на каждую передачу.
      // Brave/Safari иногда перестают слать RTP при повторном produce на старом transport.
      if (sendTransportRef.current && !sendTransportRef.current.closed) {
        sendTransportRef.current.close();
        sendTransportRef.current = null;
      }
      await createSendTransport();

      console.log('[WebRTC] startTransmitting: шаг 4 — produce, transport:', sendTransportRef.current?.id, 'listeners:', sendTransportRef.current?.listenerCount('produce'));
      const track = stream.getAudioTracks()[0];
      console.log('[WebRTC] Mic track:', track?.label, 'enabled:', track?.enabled, 'muted:', track?.muted, 'readyState:', track?.readyState);
      const producer = await sendTransportRef.current!.produce({
        track,
        codecOptions: OPUS_CODEC_OPTIONS,
      });

      producerRef.current = producer;
      console.log('[WebRTC] Трансляция начата, producerId:', producer.id);
      return producer;
    } finally {
      isStartingRef.current = false;
    }
  }, [initDevice, createSendTransport]);

  const stopTransmitting = useCallback(() => {
    if (producerRef.current && !producerRef.current.closed) {
      producerRef.current.close();
      producerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (sendTransportRef.current && !sendTransportRef.current.closed) {
      sendTransportRef.current.close();
    }
    sendTransportRef.current = null;
    if (groupId) {
      emit('ms:close-producer', { groupId }).catch(() => {});
    }
    console.log('[WebRTC] Трансляция остановлена');
  }, [groupId, emit]);

  const consumeProducer = useCallback(async (producerId: string, producerUserId: string) => {
    if (!deviceRef.current || !groupId) return;

    // Не создавать дубликат для одного и того же producer
    if (consumedProducersRef.current.has(producerId)) {
      console.log('[WebRTC] Producer уже потребляется:', producerId);
      return;
    }
    consumedProducersRef.current.add(producerId);

    try {
      // Только один recv transport — сериализуем создание
      if (!recvTransportRef.current || recvTransportRef.current.closed) {
        if (!recvTransportCreatingRef.current) {
          recvTransportCreatingRef.current = createRecvTransport()
            .then(() => undefined)
            .finally(() => {
              recvTransportCreatingRef.current = null;
            });
        }
        await recvTransportCreatingRef.current;
      }

      const { consumerId, rtpParameters } = await emit<{
        consumerId: string;
        rtpParameters: mediasoupClient.types.RtpParameters;
      }>('ms:consume', {
        groupId,
        producerId,
        rtpCapabilities: deviceRef.current!.rtpCapabilities,
      });

      const consumer = await recvTransportRef.current!.consume({
        id: consumerId,
        producerId,
        kind: 'audio',
        rtpParameters,
      });

      consumersRef.current.set(consumerId, consumer);

      const track = consumer.track;
      console.log('[WebRTC] Consumer track:', track.kind, 'muted:', track.muted, 'readyState:', track.readyState);

      // Сигнализируем серверу что клиент готов — сервер снимает паузу с consumer
      await emit('ms:resume-consumer', { groupId, consumerId });
      console.log('[WebRTC] Consumer resumed на сервере');

      // Разблокируем AudioContext перед воспроизведением
      await unlockAudio();

      const stream = new MediaStream([track]);

      // Воспроизводим через <audio> элемент — самый надёжный путь
      const audioEl = document.createElement('audio');
      audioEl.srcObject = stream;
      audioEl.autoplay = true;
      audioEl.volume = 1.0;
      document.body.appendChild(audioEl);

      const tryPlay = () =>
        audioEl.play()
          .then(() => console.log('[WebRTC] ✅ Audio playing для', producerUserId))
          .catch(async (err) => {
            console.warn('[WebRTC] Audio autoplay blocked:', err.name, '— AudioContext fallback');
            try {
              const ctx = getAudioContext();
              await ctx.resume();
              const source = ctx.createMediaStreamSource(stream);
              source.connect(ctx.destination);
              console.log('[WebRTC] AudioContext fallback активирован для', producerUserId);
            } catch (e) {
              console.error('[WebRTC] AudioContext fallback тоже не сработал:', e);
            }
          });

      tryPlay();

      track.addEventListener('unmute', () => {
        console.log('[WebRTC] ✅ Track unmuted — аудио идёт от', producerUserId);
        // Если элемент уже был создан, убеждаемся что он играет
        if (audioEl.paused) tryPlay();
      });

      const cleanup = () => {
        audioEl.srcObject = null;
        audioEl.remove();
        consumersRef.current.delete(consumerId);
        consumedProducersRef.current.delete(producerId);
        producerCleanupRef.current.delete(producerId);
        console.log('[WebRTC] Consumer закрыт для', producerUserId);
      };
      consumer.on('transportclose', cleanup);
      producerCleanupRef.current.set(producerId, cleanup);

      console.log('[WebRTC] Consumer создан для', producerUserId);
    } catch (err) {
      // При ошибке убираем из списка чтобы можно было попробовать снова
      consumedProducersRef.current.delete(producerId);
      console.error('[WebRTC] consumeProducer error:', err);
    }
  }, [groupId, emit, createRecvTransport]);

  // Подписка на новые producer'ы при входе в группу
  useEffect(() => {
    if (!groupId) return;

    const handleNewProducer = ({ producerId, producerUserId }: { producerId: string; producerUserId: string; groupId: string }) => {
      consumeProducer(producerId, producerUserId).catch(console.error);
    };

    const handleProducerClosed = ({ producerId }: { producerId: string }) => {
      console.log('[WebRTC] Producer закрыт:', producerId);
      producerCleanupRef.current.get(producerId)?.();
    };

    const init = async () => {
      await initDevice();

      // Recv transport держим заранее: слушать надо всегда.
      // Send transport создаётся на каждое нажатие PTT, чтобы не ловить
      // браузерные проблемы повторного produce.
      if (!recvTransportRef.current || recvTransportRef.current.closed) {
        await createRecvTransport().catch(console.error);
      }

      const { producers } = await emit<{ producers: Array<{ producerId: string; producerUserId: string }> }>(
        'ms:get-producers', { groupId }
      );
      for (const p of producers) {
        await consumeProducer(p.producerId, p.producerUserId);
      }
    };

    // Переподписка на всех текущих продюсеров после восстановления транспорта
    resubscribeAllRef.current = () => {
      if (disposed) return;
      console.log('[WebRTC] Resubscribing to all producers after transport recovery');
      init().catch(console.error);
    };

    let subscribedSocket: any = null;
    let disposed = false;

    const subscribe = (socket: any) => {
      if (disposed || subscribedSocket === socket) return;
      if (subscribedSocket) {
        subscribedSocket.off('ms:new-producer', handleNewProducer);
        subscribedSocket.off('ms:producer-closed', handleProducerClosed);
      }

      subscribedSocket = socket;
      socket.on('ms:new-producer', handleNewProducer);
      socket.on('ms:producer-closed', handleProducerClosed);
      init().catch(console.error);
    };

    const existingSocket = getPrivoxSocket() ?? (window as any).__privoxSocket;
    if (existingSocket) subscribe(existingSocket);

    const handleSocketReady = (event: Event) => {
      subscribe((event as CustomEvent).detail);
    };

    window.addEventListener(PRIVOX_SOCKET_READY_EVENT, handleSocketReady);

    return () => {
      disposed = true;
      window.removeEventListener(PRIVOX_SOCKET_READY_EVENT, handleSocketReady);
      if (subscribedSocket) {
        subscribedSocket.off('ms:new-producer', handleNewProducer);
        subscribedSocket.off('ms:producer-closed', handleProducerClosed);
      }
    };
  }, [groupId, consumeProducer, createRecvTransport, emit, initDevice]);

  // Очистка при смене группы
  useEffect(() => {
    return () => {
      isStartingRef.current = false;
      stopTransmitting();
      if (sendTransportRef.current && !sendTransportRef.current.closed) {
        sendTransportRef.current.close();
      }
      sendTransportRef.current = null;
      consumersRef.current.forEach((c) => c.close());
      consumersRef.current.clear();
      consumedProducersRef.current.clear();
      producerCleanupRef.current.clear();
      recvTransportRef.current?.close();
      recvTransportRef.current = null;
      deviceRef.current = null;
    };
  }, [groupId]);

  return { startTransmitting, stopTransmitting, consumeProducer };
}
