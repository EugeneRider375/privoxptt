import dgram from 'dgram';
import bcrypt from 'bcrypt';
import type { Server } from 'socket.io';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { DeviceSession } from './session';
import {
  parsePacket,
  buildAuthOk,
  buildAuthFail,
} from './protocol';

const UDP_PORT = parseInt(process.env.ESP32_BRIDGE_PORT ?? '5055', 10);

// Map: "ip:port" → DeviceSession
const sessions = new Map<string, DeviceSession>();

export function startUdpBridge(io: Server): void {
  const socket = dgram.createSocket('udp4');

  socket.on('error', (err) => {
    logger.error({ msg: 'UDP bridge socket error', err });
  });

  socket.on('message', (msg, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`;
    void handleMessage(msg, rinfo.address, rinfo.port, key, socket, io);
  });

  socket.bind(UDP_PORT, () => {
    logger.info({ msg: `ESP32 UDP bridge listening on port ${UDP_PORT}` });
  });
}

async function handleMessage(
  msg: Buffer,
  ip: string,
  port: number,
  key: string,
  socket: dgram.Socket,
  io: Server,
): Promise<void> {
  const packet = parsePacket(msg);
  if (!packet) return;

  const send = (buf: Buffer) => socket.send(buf, port, ip);

  // PING без сессии — сервер перезапустился, просим переавторизоваться
  if (packet.type === 'ping') {
    const session = sessions.get(key);
    if (session) {
      session.onPing();
    } else {
      send(buildAuthFail('session_lost'));
    }
    return;
  }

  // ── AUTH ─────────────────────────────────────────────────
  if (packet.type === 'auth') {
    const existing = sessions.get(key);
    if (existing) {
      await existing.close();
      sessions.delete(key);
    }

    const { email, password, groupId } = packet;

    try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true, password: true, isActive: true, callsign: true,
          displayName: true, organizationId: true,
          groupMembers: { select: { group: { select: { id: true, name: true } } } },
        },
      });

      if (!user || !user.isActive) {
        send(buildAuthFail('User not found'));
        return;
      }

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) {
        send(buildAuthFail('Invalid password'));
        return;
      }

      // Check group membership
      const myGroups = user.groupMembers.map((m) => m.group);
      const isMember = myGroups.some((g) => g.id === groupId);
      if (!isMember) {
        send(buildAuthFail('Not a member of this group'));
        return;
      }

      const session = new DeviceSession(
        user.id,
        user.callsign,
        user.displayName,
        user.organizationId,
        groupId,
        send,
        io,
        () => sessions.delete(key),
      );

      await session.init();
      sessions.set(key, session);
      send(buildAuthOk(myGroups));

      logger.info({ msg: 'ESP32 authenticated', userId: user.id, callsign: user.callsign, groupId, ip, port });
    } catch (err) {
      logger.error({ msg: 'ESP32 auth error', err, email, ip, port });
      send(buildAuthFail('Server error'));
    }
    return;
  }

  // All other packets require an authenticated session
  const session = sessions.get(key);
  if (!session) return;

  switch (packet.type) {
    case 'ptt_start': await session.onPttStart(); break;
    case 'ptt_stop':  await session.onPttStop();  break;
    case 'audio':     session.onAudio(packet.pcm); break;
    case 'pong':      session.onPong(); break;
  }
}
