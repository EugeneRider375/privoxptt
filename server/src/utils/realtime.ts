import type { Request } from 'express';
import type { Server } from 'socket.io';

type DataChangeType = 'groups' | 'users' | 'members' | 'sensors';

// Вышвыривает все живые сокеты пользователя. Нужно при отключении/удалении
// аккаунта: сервер проверяет isActive только в момент подключения сокета, так
// что уже подключённое устройство (например, потерянная рация) иначе осталось
// бы в эфире до следующего реконнекта. Каждый сокет входит в комнату
// `user:<id>` при подключении — по ней и рвём.
export function disconnectUserSockets(req: Request, userId: string): void {
  const io = req.app.get('io') as Server | undefined;
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export function emitOrgDataChanged(
  req: Request,
  organizationId: string,
  type: DataChangeType,
  payload: Record<string, unknown> = {}
): void {
  const io = req.app.get('io') as Server | undefined;
  io?.to(`org:${organizationId}`).emit('org-data-changed', {
    type,
    organizationId,
    ...payload,
    timestamp: Date.now(),
  });
}
