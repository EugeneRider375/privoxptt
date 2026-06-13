import { useEffect } from 'react';
import { Thermometer, Refrigerator, Home, TreePine, ShieldCheck, ShieldOff } from 'lucide-react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '@/store/useStore';
import { sensorsApi } from '@/api/client';
import { refetchSensors } from '@/utils/sensors';
import type { SensorState } from '@/types';

// полный объект датчика из GET /api/sensors → SensorState (чтобы видеть даже тихие/оффлайн)
const KIND_ICON: Record<SensorState['kind'], typeof Thermometer> = {
  FRIDGE: Refrigerator,
  INDOOR: Home,
  OUTDOOR: TreePine,
};

const STATUS_STYLE: Record<SensorState['status'], { dot: string; card: string; label: string }> = {
  OK: { dot: 'bg-ptt-green', card: 'border-ptt-border/40', label: 'text-ptt-green' },
  ALERT: { dot: 'bg-ptt-danger animate-pulse', card: 'border-ptt-danger/60 bg-ptt-danger/10 shadow-lg shadow-ptt-danger/20', label: 'text-ptt-danger' },
  STALE: { dot: 'bg-ptt-muted', card: 'border-ptt-border/40', label: 'text-ptt-muted' },
};

const UNIT: Record<string, string> = { temperature: '°C', humidity: '%', co2: 'ppm', battery: '%' };
const ORDER: Record<SensorState['status'], number> = { ALERT: 0, STALE: 1, OK: 2 };

function metricsOf(s: SensorState): Array<[string, number | boolean]> {
  if (s.metrics && Object.keys(s.metrics).length > 0) return Object.entries(s.metrics);
  const out: Array<[string, number | boolean]> = [];
  if (s.temperature != null) out.push(['temperature', s.temperature]);
  if (s.humidity != null) out.push(['humidity', s.humidity]);
  return out;
}

function fmt(metric: string, val: number | boolean): string {
  if (typeof val === 'boolean') return val ? 'yes' : 'no';
  return `${val}${UNIT[metric] ?? ''}`;
}

function SensorCard({ sensor }: { sensor: SensorState }) {
  const style = STATUS_STYLE[sensor.status];
  const KindIcon = KIND_ICON[sensor.kind] ?? Home;
  const metrics = metricsOf(sensor);
  const upsertSensor = useStore((s) => s.upsertSensor);
  const armed = sensor.armed !== false; // по умолчанию на охране

  const toggleArm = async () => {
    const next = !armed;
    upsertSensor({ ...sensor, armed: next }); // оптимистично
    try {
      await sensorsApi.arm(sensor.id, next);
    } catch {
      upsertSensor({ ...sensor, armed }); // откат при ошибке
    }
  };

  return (
    <div className={clsx('px-3 py-2 border-b transition-colors', style.card, !armed && 'opacity-80')}>
      <div className="flex items-center gap-2">
        <span className={clsx('w-2 h-2 rounded-full shrink-0', style.dot)} />
        <KindIcon className="w-3.5 h-3.5 text-ptt-text shrink-0" />
        <span className="font-rajdhani font-semibold text-sm text-white truncate flex-1">{sensor.name}</span>
        {!armed && <span className="font-mono text-[10px] tracking-widest text-ptt-warn shrink-0">DISARMED</span>}
        <span className={clsx('font-mono text-[10px] tracking-widest', style.label)}>{sensor.status}</span>
        <button
          onClick={toggleArm}
          title={armed ? 'На охране — снять' : 'Снято — поставить на охрану'}
          className={clsx('shrink-0 transition-colors', armed ? 'text-ptt-green hover:text-white' : 'text-ptt-warn hover:text-white')}
        >
          {armed ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex items-center gap-3 mt-1 pl-4 font-mono text-xs flex-wrap">
        {metrics.length === 0 ? (
          <span className="text-ptt-muted">—</span>
        ) : (
          metrics.map(([k, v]) => (
            <span key={k} className="text-white/80">
              <span className="text-ptt-muted">{k}</span> {fmt(k, v)}
            </span>
          ))
        )}
        {sensor.lastSeenAt && (
          <span className="ml-auto text-ptt-muted text-[10px]">
            {formatDistanceToNow(new Date(sensor.lastSeenAt), { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  );
}

export function SensorPanel() {
  const sensors = useStore((s) => s.sensors);

  // начальная загрузка: показать ВСЕ датчики орга (в т.ч. тихие/оффлайн), чтобы можно
  // было снять/поставить на охрану даже тот, что ничего не присылал. Живые sensor-update приоритетнее.
  // На reconnect сокета рефетч повторяется из useSocket (пропущенные события).
  useEffect(() => {
    void refetchSensors();
  }, []);
  // тревоги/офлайн сверху, потом OK; внутри — по имени
  const list = Object.values(sensors).sort(
    (a, b) => (ORDER[a.status] - ORDER[b.status]) || a.name.localeCompare(b.name),
  );
  const alerting = list.filter((s) => s.status === 'ALERT' || s.status === 'STALE').length;

  return (
    <div className="flex flex-col h-full bg-ptt-dark">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-ptt-border shrink-0">
        <Thermometer className="w-3.5 h-3.5 text-ptt-text" />
        <p className="font-mono text-ptt-text text-xs tracking-widest">SENSORS</p>
        <span className="font-mono text-ptt-muted text-xs">{list.length}</span>
        <span className={clsx('ml-auto font-mono text-xs', alerting > 0 ? 'text-ptt-danger' : 'text-ptt-green')}>
          {alerting > 0 ? `${alerting} ALERT` : list.length ? 'ALL OK' : '—'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <p className="font-mono text-ptt-muted text-xs text-center py-8">нет датчиков (ждём данные…)</p>
        ) : (
          list.map((sensor) => <SensorCard key={sensor.id} sensor={sensor} />)
        )}
      </div>
    </div>
  );
}
