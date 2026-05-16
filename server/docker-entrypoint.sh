#!/bin/sh
set -e

echo "Применение миграций Prisma..."
npx prisma migrate deploy

echo "Запуск seed (создание суперадмина)..."
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function seed() {
  const email = process.env.SUPERADMIN_EMAIL || 'admin@privox.tech';
  const password = process.env.SUPERADMIN_PASSWORD;
  const callsign = process.env.SUPERADMIN_CALLSIGN || 'ALPHA-0';

  if (!password) { console.log('SUPERADMIN_PASSWORD не задан, пропускаем seed'); return; }

  let org = await prisma.organization.findUnique({ where: { slug: 'privox' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'PrivoxPTT', slug: 'privox', description: 'Основная организация' }
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { email, password: hash, callsign, displayName: 'Super Admin', role: 'SUPERADMIN', organizationId: org.id }
    });
    console.log('Суперадмин создан:', email);
  } else {
    console.log('Суперадмин уже существует:', email);
  }
}

seed().catch(console.error).finally(() => prisma.\$disconnect());
"

echo "Запуск PrivoxPTT сервера..."
exec node dist/index.js
