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

echo "Запуск seed датчиков (Frigo + HomeClimate)..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const renameMap = { 'Холодильник': 'Fridge', 'Улица': 'Outdoor', 'Дом': 'Indoor' };

const sensors = [
  { name: 'Fridge', kind: 'FRIDGE', adapter: 'FRIGO', sourceUrl: 'https://frigo.privox.tech/api/stats', externalId: null, thresholds: { temperature: { min: 2, max: 8 } }, groupId: 'group-emergency' },
  { name: 'Outdoor', kind: 'OUTDOOR', adapter: 'HOMECLIMATE', sourceUrl: 'https://temperature.privox.tech/api/latest', externalId: '1', thresholds: {}, groupId: 'group-general' },
  { name: 'Indoor', kind: 'INDOOR', adapter: 'HOMECLIMATE', sourceUrl: 'https://temperature.privox.tech/api/latest', externalId: '2', thresholds: { temperature: { min: 10 }, humidity: { max: 70 } }, groupId: 'group-emergency' },
];

async function seedSensors() {
  // Предохранитель: сеять только на ПУСТОЙ базе. На заполненной ничего не трогаем —
  // иначе каждый деплой плодит дубли Fridge/Indoor/Outdoor (перенос в другую группу/орг
  // делает их невидимыми для проверки по имени, и сид создаёт копии заново).
  const total = await prisma.sensor.count();
  if (total > 0) { console.log('датчики уже есть (' + total + ') — сид датчиков пропущен'); return; }
  const org = await prisma.organization.findUnique({ where: { slug: 'privox' } });
  if (!org) { console.log('Org privox не найдена, пропускаем сид датчиков'); return; }
  for (const [oldN, newN] of Object.entries(renameMap)) {
    const r = await prisma.sensor.updateMany({ where: { organizationId: org.id, name: oldN }, data: { name: newN } });
    if (r.count) console.log('Переименован датчик:', oldN, '->', newN);
  }
  for (const s of sensors) {
    const existing = await prisma.sensor.findFirst({ where: { organizationId: org.id, name: s.name } });
    if (existing) { console.log('Датчик уже есть:', s.name); continue; }
    let groupId = null;
    if (s.groupId) {
      const g = await prisma.group.findUnique({ where: { id: s.groupId } });
      groupId = g ? s.groupId : null;
    }
    await prisma.sensor.create({ data: { organizationId: org.id, name: s.name, kind: s.kind, adapter: s.adapter, sourceUrl: s.sourceUrl, externalId: s.externalId, thresholds: s.thresholds, groupId } });
    console.log('Датчик создан:', s.name);
  }
}

seedSensors().catch(console.error).finally(() => prisma.\$disconnect());
"

echo "Запуск PrivoxPTT сервера..."
exec node dist/index.js
