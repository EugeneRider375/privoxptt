// Разовый живой тест поллера против боевых датчиков.
// Запуск: npx ts-node prisma/test-poll-once.ts
// Мок io логирует то, что ушло бы на дашборд (sensor-update / sensor-alert).

import { pollOnce } from '../src/services/sensorPoller';

const io: any = {
  to: (room: string) => ({
    emit: (event: string, payload: unknown) => {
      console.log(`EMIT → [${room}] ${event}:`, JSON.stringify(payload));
    },
  }),
};

pollOnce(io)
  .then(() => {
    console.log('--- цикл завершён ---');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
