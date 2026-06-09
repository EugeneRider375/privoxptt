// Адаптеры внешних датчиков.
// Превращают ответ публичного API датчика в единый формат NormalizedReading.
// ВАЖНО: прошивки и бэкенды датчиков (Frigo, HomeClimate) НЕ трогаются —
// мы только читаем их публичный JSON и парсим.

export interface NormalizedReading {
  temperature: number | null;
  humidity: number | null;
  observedAt: Date | null; // время замера по данным источника
}

export interface MetricRule {
  min?: number;
  max?: number;
}

export interface Thresholds {
  temperature?: MetricRule;
  humidity?: MetricRule;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Frigo: GET https://frigo.privox.tech/api/stats
// → { current, min, max, avg, last_seen }
export function normalizeFrigo(json: unknown): NormalizedReading {
  const o = (json ?? {}) as Record<string, unknown>;
  return {
    temperature: num(o.current),
    humidity: null,
    observedAt: parseDate(o.last_seen),
  };
}

// HomeClimate: GET https://temperature.privox.tech/api/latest
// → [ { sensor_id, temperature, humidity, temp_valid, hum_valid, created_at }, ... ]
// externalId выбирает нужный датчик (1 = улица, 2 = дом).
export function normalizeHomeclimate(json: unknown, externalId: string | null): NormalizedReading {
  const arr = Array.isArray(json) ? (json as Array<Record<string, unknown>>) : [];
  const row = arr.find((r) => String(r?.sensor_id) === String(externalId));
  if (!row) return { temperature: null, humidity: null, observedAt: null };
  return {
    temperature: row.temp_valid ? num(row.temperature) : null,
    humidity: row.hum_valid ? num(row.humidity) : null,
    observedAt: parseDate(row.created_at),
  };
}

const RU_LABEL: Record<keyof Thresholds, string> = {
  temperature: 'температура',
  humidity: 'влажность',
};

const UNIT: Record<keyof Thresholds, string> = {
  temperature: '°C',
  humidity: '%',
};

// Возвращает список причин тревоги (пустой = всё в норме).
export function evaluateThresholds(reading: NormalizedReading, thresholds: Thresholds): string[] {
  const reasons: string[] = [];
  (['temperature', 'humidity'] as Array<keyof Thresholds>).forEach((metric) => {
    const value = reading[metric];
    const rule = thresholds[metric];
    if (value == null || !rule) return;
    if (rule.max != null && value > rule.max) {
      reasons.push(`${RU_LABEL[metric]} ${value}${UNIT[metric]} > ${rule.max}${UNIT[metric]}`);
    }
    if (rule.min != null && value < rule.min) {
      reasons.push(`${RU_LABEL[metric]} ${value}${UNIT[metric]} < ${rule.min}${UNIT[metric]}`);
    }
  });
  return reasons;
}
