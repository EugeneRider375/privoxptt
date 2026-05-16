import { Server } from 'socket.io';
import type { DtlsParameters, RtpParameters, RtpCapabilities } from 'mediasoup/node/lib/types';
import { mediasoupManager } from './server';
import { PeerTransportManager } from './transport';
import { logger } from '../utils/logger';
import type { AuthenticatedSocket } from '../socket/index';

// groupId → (socketId → PeerTransportManager)
// Каждое соединение (socketId) имеет независимые транспорты.
// Один пользователь с двух вкладок → две записи, не мешают друг другу.
const groupPeers = new Map<string, Map<string, PeerTransportManager>>();

function getOrCreateGroupPeers(groupId: string): Map<string, PeerTransportManager> {
  if (!groupPeers.has(groupId)) {
    groupPeers.set(groupId, new Map());
  }
  return groupPeers.get(groupId)!;
}

function cleanupPeer(groupId: string, socketId: string): void {
  const peers = groupPeers.get(groupId);
  if (!peers) return;

  const peer = peers.get(socketId);
  if (peer) {
    peer.close();
    peers.delete(socketId);
  }

  if (peers.size === 0) {
    groupPeers.delete(groupId);
    mediasoupManager.closeGroupRouter(groupId);
  }
}

export function setupMediasoupSocket(io: Server, socket: AuthenticatedSocket): void {
  const { userId } = socket.data;
  const socketId = socket.id;

  // ─── RTP capabilities ────────────────────────────────────
  socket.on(
    'ms:get-rtp-capabilities',
    async ({ groupId }: { groupId: string }, callback: (data: object) => void) => {
      try {
        const capabilities = await mediasoupManager.getRtpCapabilities(groupId);
        callback({ rtpCapabilities: capabilities });
      } catch (err) {
        logger.error({ msg: 'Ошибка get-rtp-capabilities', err, groupId, userId });
        callback({ error: 'Failed to get RTP capabilities' });
      }
    }
  );

  // ─── Send transport ───────────────────────────────────────
  socket.on(
    'ms:create-send-transport',
    async ({ groupId }: { groupId: string }, callback: (data: object) => void) => {
      try {
        const router = await mediasoupManager.getOrCreateGroupRouter(groupId);
        const peers = getOrCreateGroupPeers(groupId);

        let manager = peers.get(socketId);
        if (!manager) {
          manager = new PeerTransportManager(router, socketId, userId, socket.data.callsign);
          peers.set(socketId, manager);
        }

        const transportInfo = await manager.createSendTransport();
        callback({ transportInfo });
      } catch (err) {
        logger.error({ msg: 'Ошибка create-send-transport', err, userId, groupId });
        callback({ error: 'Failed to create transport' });
      }
    }
  );

  // ─── Recv transport ───────────────────────────────────────
  socket.on(
    'ms:create-recv-transport',
    async ({ groupId }: { groupId: string }, callback: (data: object) => void) => {
      try {
        const router = await mediasoupManager.getOrCreateGroupRouter(groupId);
        const peers = getOrCreateGroupPeers(groupId);

        let manager = peers.get(socketId);
        if (!manager) {
          manager = new PeerTransportManager(router, socketId, userId, socket.data.callsign);
          peers.set(socketId, manager);
        }

        const transportInfo = await manager.createRecvTransport();
        callback({ transportInfo });
      } catch (err) {
        logger.error({ msg: 'Ошибка create-recv-transport', err, userId, groupId });
        callback({ error: 'Failed to create receive transport' });
      }
    }
  );

  // ─── Connect send transport ───────────────────────────────
  socket.on(
    'ms:connect-send-transport',
    async (
      { groupId, dtlsParameters }: { groupId: string; dtlsParameters: DtlsParameters },
      callback: (data: object) => void
    ) => {
      try {
        const manager = groupPeers.get(groupId)?.get(socketId);
        if (!manager) throw new Error('Transport manager not found');
        await manager.connectSendTransport(dtlsParameters);
        callback({ connected: true });
      } catch (err) {
        logger.error({ msg: 'Ошибка connect-send-transport', err });
        callback({ error: 'Failed to connect transport' });
      }
    }
  );

  // ─── Connect recv transport ───────────────────────────────
  socket.on(
    'ms:connect-recv-transport',
    async (
      { groupId, dtlsParameters }: { groupId: string; dtlsParameters: DtlsParameters },
      callback: (data: object) => void
    ) => {
      try {
        logger.debug({ msg: 'ms:connect-recv-transport', userId, groupId });
        const manager = groupPeers.get(groupId)?.get(socketId);
        if (!manager) throw new Error('Transport manager not found');
        await manager.connectRecvTransport(dtlsParameters);
        callback({ connected: true });
      } catch (err) {
        logger.error({ msg: 'Ошибка connect-recv-transport', err });
        callback({ error: 'Failed to connect receive transport' });
      }
    }
  );

  // ─── Produce ──────────────────────────────────────────────
  socket.on(
    'ms:produce',
    async (
      { groupId, rtpParameters }: { groupId: string; rtpParameters: RtpParameters },
      callback: (data: object) => void
    ) => {
      try {
        const manager = groupPeers.get(groupId)?.get(socketId);
        if (!manager) throw new Error('Transport manager not found');

        // Закрываем старые продюсеры этого пользователя от других сокетов
        // (дублирующие вкладки, ghost-соединения) — один пользователь = один продюсер
        const peers = groupPeers.get(groupId);
        if (peers) {
          for (const [otherSocketId, otherManager] of peers.entries()) {
            if (otherSocketId !== socketId && otherManager.userId === userId) {
              const oldProducerId = otherManager.getProducerId();
              if (oldProducerId) {
                otherManager.closeProducer();
                socket.to(groupId).emit('ms:producer-closed', {
                  groupId, producerId: oldProducerId, producerUserId: userId,
                });
                logger.debug({ msg: 'Закрыт дублирующий продюсер', userId, oldProducerId });
              }
            }
          }
        }

        const producerId = await manager.produce(rtpParameters);

        socket.to(groupId).emit('ms:new-producer', {
          groupId,
          producerId,
          producerUserId: userId,
          callsign: socket.data.callsign,
        });

        callback({ producerId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ msg: 'Ошибка produce', err: msg, userId, groupId });
        callback({ error: msg });
      }
    }
  );

  // ─── Consume ──────────────────────────────────────────────
  socket.on(
    'ms:consume',
    async (
      { groupId, producerId, rtpCapabilities }: { groupId: string; producerId: string; rtpCapabilities: RtpCapabilities },
      callback: (data: object) => void
    ) => {
      try {
        const manager = groupPeers.get(groupId)?.get(socketId);
        if (!manager) throw new Error('Transport manager not found');

        const { consumerId, rtpParameters } = await manager.consume(producerId, rtpCapabilities);
        callback({ consumerId, rtpParameters, producerId });
      } catch (err) {
        logger.error({ msg: 'Ошибка consume', err, userId, groupId });
        callback({ error: 'Failed to create consumer' });
      }
    }
  );

  // ─── Close producer (PTT release) ─────────────────────────
  socket.on(
    'ms:close-producer',
    async ({ groupId }: { groupId: string }, callback: (data: object) => void) => {
      try {
        const manager = groupPeers.get(groupId)?.get(socketId);
        if (!manager) { callback({ ok: true }); return; }

        const producerId = manager.getProducerId();
        manager.closeProducer();

        if (producerId) {
          socket.to(groupId).emit('ms:producer-closed', { groupId, producerId, producerUserId: userId });
        }
        callback({ ok: true });
      } catch (err) {
        logger.error({ msg: 'Ошибка close-producer', err, userId, groupId });
        callback({ error: 'Failed to close producer' });
      }
    }
  );

  // ─── Resume consumer ──────────────────────────────────────
  socket.on(
    'ms:resume-consumer',
    async (
      { groupId, consumerId }: { groupId: string; consumerId: string },
      callback: (data: object) => void
    ) => {
      try {
        const manager = groupPeers.get(groupId)?.get(socketId);
        if (!manager) throw new Error('Transport manager not found');
        await manager.resumeConsumer(consumerId);
        callback({ resumed: true });
      } catch (err) {
        logger.error({ msg: 'Ошибка resume-consumer', err, userId, groupId, consumerId });
        callback({ error: 'Failed to resume consumer' });
      }
    }
  );

  // ─── Get producers ────────────────────────────────────────
  socket.on(
    'ms:get-producers',
    async ({ groupId }: { groupId: string }, callback: (data: object) => void) => {
      try {
        const peers = groupPeers.get(groupId);
        const producers: { producerId: string; producerUserId: string; callsign: string }[] = [];

        if (peers) {
          for (const [peerSocketId, manager] of peers.entries()) {
            if (peerSocketId === socketId) continue; // не потреблять свои же
            if (manager.userId === userId) continue; // не потреблять другую вкладку себя
            const producerId = manager.getProducerId();
            if (producerId) {
              producers.push({
                producerId,
                producerUserId: manager.userId,
                callsign: manager.callsign,
              });
            }
          }
        }

        callback({ producers });
      } catch (err) {
        logger.error({ msg: 'Ошибка get-producers', err });
        callback({ error: 'Failed to get producers' });
      }
    }
  );

  // ─── Disconnect cleanup ───────────────────────────────────
  socket.on('disconnect', () => {
    for (const [groupId, peers] of groupPeers.entries()) {
      if (peers.has(socketId)) {
        const producerId = peers.get(socketId)?.getProducerId();

        if (producerId) {
          socket.to(groupId).emit('ms:producer-closed', {
            groupId,
            producerId,
            producerUserId: userId,
          });
        }

        cleanupPeer(groupId, socketId);
      }
    }
  });
}
