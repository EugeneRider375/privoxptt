// Адаптеры внешних датчиков + универсальные МЕТРИКИ и ПРАВИЛА порогов.
// Прошивки/бэкенды датчиков НЕ трогаем — читаем их публичный JSON.

export type MetricValue = number | boolean;

export interface NormalizedReading {
  metrics: Record<string, MetricValue>;
  observedAt: Date | null;
}

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type RuleOp = 'gt' | 'lt' | 'outside' | 'is';

// Правило порога: одна метрика + условие + важность (+ дебаунс).
export interface ThresholdRule {
  id: string;
  metric: string;
  op: RuleOp;
  value?: number | boolean; // для gt/lt/is
  min?: number; // для outside
  max?: number; // для outside
  severity?: Severity; // по умолчанию CRITICAL
  sustainedSec?: number; // условие должно держаться N сек (дебаунс)
}

export interface FiredRule {
  ruleId: string;
  metric: string;
  severity: Severity;
  message: string;
  value: MetricValue;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Frigo: GET frigo.privox.tech/api/stats → { current, last_seen }
export function normalizeFrigo(json: unknown): NormalizedReading {
  const o = (json ?? {}) as Record<string, unknown>;
  const t = num(o.current);
  const metrics: Record<string, MetricValue> = {};
  if (t !== null) metrics.temperature = t;
  return { metrics, observedAt: parseDate(o.last_seen) };
}

// HomeClimate: GET temperature.privox.tech/api/latest → [{sensor_id,temperature,humidity,...}]
export function normalizeHomeclimate(json: unknown, externalId: string | null): NormalizedReading {
  const arr = Array.isArray(json) ? (json as Array<Record<string, unknown>>) : [];
  const row = arr.find((r) => String(r?.sensor_id) === String(externalId));
  const metrics: Record<string, MetricValue> = {};
  if (!row) return { metrics, observedAt: null };
  const t = row.temp_valid ? num(row.temperature) : null;
  const h = row.hum_valid ? num(row.humidity) : null;
  if (t !== null) metrics.temperature = t;
  if (h !== null) metrics.humidity = h;
  return { metrics, observedAt: parseDate(row.created_at) };
}

const UNIT: Record<string, string> = {
  temperature: '°C', humidity: '%', waterLevel: '', co2: 'ppm', battery: '%',
};
function unit(metric: string): string {
  return UNIT[metric] ?? '';
}

// Старый формат порогов { temperature:{min,max}, humidity:{max} } → массив правил.
// Новый формат (массив правил) возвращается как есть.
export function thresholdsToRules(thresholds: unknown): ThresholdRule[] {
  if (Array.isArray(thresholds)) {
    return (thresholds as ThresholdRule[]).filter((r) => r && r.metric && r.op);
  }
  const out: ThresholdRule[] = [];
  const obj = (thresholds ?? {}) as Record<string, { min?: number; max?: number }>;
  for (const [metric, rule] of Object.entries(obj)) {
    if (!rule || typeof rule !== 'object') continue;
    const hasMin = typeof rule.min === 'number';
    const hasMax = typeof rule.max === 'number';
    if (hasMin && hasMax) out.push({ id: metric, metric, op: 'outside', min: rule.min, max: rule.max, severity: 'CRITICAL' });
    else if (hasMax) out.push({ id: metric, metric, op: 'gt', value: rule.max, severity: 'CRITICAL' });
    else if (hasMin) out.push({ id: metric, metric, op: 'lt', value: rule.min, severity: 'CRITICAL' });
  }
  return out;
}

// Проверка правил против метрик. Возвращает сработавшие.
export function evaluateRules(
  metrics: Record<string, MetricValue>,
  rules: ThresholdRule[],
): FiredRule[] {
  const fired: FiredRule[] = [];
  for (const rule of rules) {
    const v = metrics[rule.metric];
    if (v === undefined) continue;
    const u = unit(rule.metric);
    let hit = false;
    let msg = '';

    if (rule.op === 'gt' && typeof v === 'number' && typeof rule.value === 'number') {
      hit = v > rule.value;
      msg = `${rule.metric} ${v}${u} > ${rule.value}${u}`;
    } else if (rule.op === 'lt' && typeof v === 'number' && typeof rule.value === 'number') {
      hit = v < rule.value;
      msg = `${rule.metric} ${v}${u} < ${rule.value}${u}`;
    } else if (rule.op === 'outside' && typeof v === 'number') {
      if (rule.max !== undefined && v > rule.max) { hit = true; msg = `${rule.metric} ${v}${u} > ${rule.max}${u}`; }
      else if (rule.min !== undefined && v < rule.min) { hit = true; msg = `${rule.metric} ${v}${u} < ${rule.min}${u}`; }
    } else if (rule.op === 'is') {
      // value опц.: если правило сохранено без него (дефолт UI), считаем «is true».
      // Boolean-приведение переживает строковый "true"/"false" и 0/1.
      const want = rule.value === undefined ? true : Boolean(rule.value);
      hit = Boolean(v) === want;
      msg = `${rule.metric} = ${v}`;
    }

    if (hit) {
      fired.push({
        ruleId: rule.id ?? rule.metric,
        metric: rule.metric,
        severity: rule.severity ?? 'CRITICAL',
        message: msg,
        value: v,
      });
    }
  }
  return fired;
}
