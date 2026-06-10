// Идемпотентный сид внешних датчиков (Frigo + HomeClimate).
// Запуск: npx ts-node prisma/seed-sensors.ts
// Безопасно: создаёт датчик только если его ещё нет (по name+organizationId).

import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_SLUG = 'privox';
const GROUP_EMERGENCY = 'group-emergency';
const GROUP_GENERAL = 'group-general';

type SeedSensor = {
  name: string;
  kind: 'FRIDGE' | 'OUTDOOR' | 'INDOOR';
  adapter: 'FRIGO' | 'HOMECLIMATE';
  sourceUrl: string;
  externalId: string | null;
  thresholds: Prisma.InputJsonValue;
  groupId: string | null;
};

const sensors: SeedSensor[] = [
  {
    name: 'Fridge',
    kind: 'FRIDGE',
    adapter: 'FRIGO',
    sourceUrl: 'https://frigo.privox.tech/api/stats',
    externalId: null,
    thresholds: { temperature: { min: 2, max: 8 } },
    groupId: GROUP_EMERGENCY,
  },
  {
    name: 'Outdoor',
    kind: 'OUTDOOR',
    adapter: 'HOMECLIMATE',
    sourceUrl: 'https://temperature.privox.tech/api/latest',
    externalId: '1',
    thresholds: {}, // только информация, без тревог
    groupId: GROUP_GENERAL,
  },
  {
    name: 'Indoor',
    kind: 'INDOOR',
    adapter: 'HOMECLIMATE',
    sourceUrl: 'https://temperature.privox.tech/api/latest',
    externalId: '2',
    thresholds: { temperature: { min: 10 }, humidity: { max: 70 } },
    groupId: GROUP_EMERGENCY,
  },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    console.error(`Организация со slug='${ORG_SLUG}' не найдена`);
    process.exit(1);
  }
  const ORG_ID = org.id;

  for (const s of sensors) {
    const existing = await prisma.sensor.findFirst({
      where: { organizationId: ORG_ID, name: s.name },
      select: { id: true },
    });
    if (existing) {
      console.log(`= уже есть: ${s.name} (${existing.id})`);
      continue;
    }
    const created = await prisma.sensor.create({
      data: {
        organizationId: ORG_ID,
        name: s.name,
        kind: s.kind,
        adapter: s.adapter,
        sourceUrl: s.sourceUrl,
        externalId: s.externalId,
        thresholds: s.thresholds,
        groupId: s.groupId,
      },
      select: { id: true },
    });
    console.log(`+ создан: ${s.name} (${created.id})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
