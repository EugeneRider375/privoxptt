import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Zod ошибки валидации
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Ошибка валидации',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  // Prisma: уникальный constraint
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[]) ?? [];
      res.status(409).json({
        error: `Запись уже существует (${fields.join(', ')})`,
        code: 'DUPLICATE',
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Запись не найдена', code: 'NOT_FOUND' });
      return;
    }
  }

  // Наши ошибки приложения
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Неожиданная ошибка
  logger.error({ msg: 'Необработанная ошибка', err, path: req.path });
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Маршрут не найден: ${req.method} ${req.path}` });
}
