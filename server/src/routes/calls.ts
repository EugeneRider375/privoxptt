import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { respondToCallWithToken } from '../services/calls';

export const callsRouter = Router();

const responseSchema = z.object({
  callId: z.string().uuid(),
  responseToken: z.string().length(64),
  status: z.enum(['answered', 'declined']),
});

callsRouter.post('/respond', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = responseSchema.parse(req.body);
    const io = req.app.get('io') as Server | undefined;
    if (!io) {
      res.status(503).json({ ok: false, error: 'realtime_unavailable' });
      return;
    }

    const accepted = respondToCallWithToken(
      io,
      data.callId,
      data.responseToken,
      data.status,
    );
    if (!accepted) {
      res.status(404).json({ ok: false, error: 'call_not_found_or_expired' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

