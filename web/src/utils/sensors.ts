// Общие хелперы датчиков: маппинг ответа API → SensorState и рефетч списка.
// Рефетч нужен и на mount панели, и на reconnect сокета (пропущенный sensor-update
// иначе не доезжает → панель залипает в устаревшем состоянии до ручного refresh).
import { sensorsApi } from '@/api/client';
import { useStore } from '@/store/useStore';
import type { SensorState } from '@/types';

export function toSensorState(s: Record<string, unknown>): SensorState {
  const lv = (s.lastValue ?? {}) as Record<string, number | boolean>;
  return {
    id: String(s.id),
    name: String(s.name),
    kind: s.kind as SensorState['kind'],
    status: s.status as SensorState['status'],
    armed: s.armed as boolean | undefined,
    metrics: lv,
    temperature: typeof lv.temperature === 'number' ? lv.temperature : null,
    humidity: typeof lv.humidity === 'number' ? lv.humidity : null,
    lat: (s.lat as number | null) ?? null,
    lng: (s.lng as number | null) ?? null,
    lastSeenAt: (s.lastSeenAt as string | null) ?? null,
  };
}

// Тянет полный список датчиков и засевает стор. Только для ролей с доступом
// (иначе 403). Ошибки глотаем — это фоновая реконсиляция, не критичный путь.
export async function refetchSensors(): Promise<void> {
  const role = useStore.getState().user?.role;
  if (role !== 'DISPATCHER' && role !== 'ADMIN' && role !== 'SUPERADMIN') return;
  try {
    const list: Array<Record<string, unknown>> = await sensorsApi.list();
    useStore.getState().seedSensors(list.map(toSensorState));
  } catch {
    /* фоновая реконсиляция — молчим */
  }
}
