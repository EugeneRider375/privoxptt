import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../database/prisma';
import { authenticate, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { UserRole } from '@prisma/client';

export const organizationsRouter = Router();

// Все маршруты требуют авторизации
organizationsRouter.use(authenticate);

const createOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Только строчные буквы, цифры и дефис'),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
});

const updateOrgSchema = createOrgSchema.partial();

// GET /api/orgs — только суперадмин видит все
organizationsRouter.get('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await prisma.organization.findMany({
      include: {
        _count: { select: { users: true, groups: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orgs);
  } catch (err) {
    next(err);
  }
});

// GET /api/orgs/:id
organizationsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Обычный пользователь видит только свою организацию
    if (req.user!.role !== UserRole.SUPERADMIN && req.user!.organizationId !== id) {
      throw new AppError(403, 'Доступ запрещён');
    }

    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, groups: true } },
      },
    });

    if (!org) throw new AppError(404, 'Организация не найдена');
    res.json(org);
  } catch (err) {
    next(err);
  }
});

// POST /api/orgs — только суперадмин
organizationsRouter.post('/', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createOrgSchema.parse(req.body);
    const org = await prisma.organization.create({ data });
    res.status(201).json(org);
  } catch (err) {
    next(err);
  }
});

// PUT /api/orgs/:id
organizationsRouter.put('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (req.user!.role !== UserRole.SUPERADMIN && req.user!.organizationId !== id) {
      throw new AppError(403, 'Доступ запрещён');
    }

    const data = updateOrgSchema.parse(req.body);
    const org = await prisma.organization.update({ where: { id }, data });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/orgs/:id — только суперадмин
organizationsRouter.delete('/:id', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await prisma.organization.delete({ where: { id } });
    res.json({ message: 'Организация удалена' });
  } catch (err) {
    next(err);
  }
});
