import type { Request } from 'express';
import type { Server } from 'socket.io';

type DataChangeType = 'groups' | 'users' | 'members';

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
