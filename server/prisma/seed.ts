import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const hash = (p: string) => bcrypt.hash(p, 10);

async function main() {
  console.log('=== PrivoxPTT Seed ===');

  // ─── Организация ───────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'privox' },
    update: {},
    create: {
      name: 'PrivoxPTT Demo',
      slug: 'privox',
      description: 'Демо организация для тестирования',
    },
  });
  console.log(`Org: ${org.name}`);

  // ─── Пользователи ──────────────────────────────────────
  const users = [
    {
      email: process.env.SUPERADMIN_EMAIL || 'admin@privox.tech',
      password: process.env.SUPERADMIN_PASSWORD || 'Admin123!',
      callsign: 'ALPHA-0',
      displayName: 'Администратор',
      role: UserRole.SUPERADMIN,
    },
    {
      email: 'dispatcher@privox.tech',
      password: 'Disp123!',
      callsign: 'ДИСПЕТЧЕР',
      displayName: 'Диспетчер Центр',
      role: UserRole.DISPATCHER,
    },
    {
      email: 'unit1@privox.tech',
      password: 'Unit123!',
      callsign: 'БРAVO-1',
      displayName: 'Иванов И.И.',
      role: UserRole.USER,
    },
    {
      email: 'unit2@privox.tech',
      password: 'Unit123!',
      callsign: 'БРAVO-2',
      displayName: 'Петров П.П.',
      role: UserRole.USER,
    },
    {
      email: 'unit3@privox.tech',
      password: 'Unit123!',
      callsign: 'CHARLIE-1',
      displayName: 'Сидоров С.С.',
      role: UserRole.USER,
    },
    {
      email: 'unit4@privox.tech',
      password: 'Unit123!',
      callsign: 'DELTA-1',
      displayName: 'Козлов К.К.',
      role: UserRole.USER,
    },
  ];

  const createdUsers: { id: string; callsign: string }[] = [];
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (!existing) {
      const user = await prisma.user.create({
        data: {
          ...u,
          password: await hash(u.password),
          organizationId: org.id,
        },
      });
      createdUsers.push({ id: user.id, callsign: user.callsign });
      console.log(`  + ${user.callsign} (${u.role}) — ${u.email} / ${u.password}`);
    } else {
      createdUsers.push({ id: existing.id, callsign: existing.callsign });
      console.log(`  = ${existing.callsign} — уже существует`);
    }
  }

  // ─── Группы ────────────────────────────────────────────
  const groups = [
    { id: 'group-general',   name: 'Общий канал',    color: '#3DDC84', priority: 0,   description: 'Общая связь всех абонентов' },
    { id: 'group-dispatch',  name: 'Диспетчерский',  color: '#4A9EFF', priority: 10,  description: 'Канал диспетчера' },
    { id: 'group-bravo',     name: 'Группа BRAVO',   color: '#FFB800', priority: 5,   description: 'Оперативная группа' },
    { id: 'group-emergency', name: 'ЭКСТРЕННЫЙ',     color: '#FF4444', priority: 100, description: 'Экстренный канал' },
  ];

  for (const g of groups) {
    const group = await prisma.group.upsert({
      where: { id: g.id },
      update: {},
      create: { ...g, organizationId: org.id },
    });
    console.log(`Group: ${group.name}`);
  }

  // ─── Добавляем всех в Общий канал ──────────────────────
  for (const u of createdUsers) {
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: u.id, groupId: 'group-general' } },
      update: {},
      create: { userId: u.id, groupId: 'group-general', canSpeak: true },
    });
  }

  // ─── BRAVO-1, BRAVO-2 в группу BRAVO ───────────────────
  const bravoUsers = createdUsers.filter((u) =>
    ['БРAVO-1', 'БРAVO-2'].includes(u.callsign)
  );
  for (const u of bravoUsers) {
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: u.id, groupId: 'group-bravo' } },
      update: {},
      create: { userId: u.id, groupId: 'group-bravo', canSpeak: true },
    });
  }

  // ─── Диспетчер во все группы ───────────────────────────
  const dispatcher = createdUsers.find((u) => u.callsign === 'ДИСПЕТЧЕР');
  if (dispatcher) {
    for (const g of groups) {
      await prisma.groupMember.upsert({
        where: { userId_groupId: { userId: dispatcher.id, groupId: g.id } },
        update: {},
        create: { userId: dispatcher.id, groupId: g.id, canSpeak: true },
      });
    }
  }

  // ─── Все в экстренный канал ────────────────────────────
  for (const u of createdUsers) {
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: u.id, groupId: 'group-emergency' } },
      update: {},
      create: { userId: u.id, groupId: 'group-emergency', canSpeak: true },
    });
  }

  console.log('\n=== Тестовые аккаунты ===');
  console.log('SUPERADMIN:  admin@privox.tech     / Admin123!');
  console.log('DISPATCHER:  dispatcher@privox.tech / Disp123!');
  console.log('USER:        unit1@privox.tech      / Unit123!  (BRAVO-1)');
  console.log('USER:        unit2@privox.tech      / Unit123!  (BRAVO-2)');
  console.log('USER:        unit3@privox.tech      / Unit123!  (CHARLIE-1)');
  console.log('USER:        unit4@privox.tech      / Unit123!  (DELTA-1)');
  console.log('\nSeed завершён!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
