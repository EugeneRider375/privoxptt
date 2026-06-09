import { Thermometer, Droplets, Refrigerator, Home, TreePine } from 'lucide-react';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '@/store/useStore';
import type { SensorState } from '@/types';

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

function fmt(n: number | null, unit: string): string {
  return n == null ? '—' : `${n.toFixed(1)}${unit}`;
}

function SensorCard({ sensor }: { sensor: SensorState }) {
  const style = STATUS_STYLE[sensor.status];
  const KindIcon = KIND_ICON[sensor.kind];

  return (
    <div className={clsx('px-3 py-2 border-b transition-colors', style.card)}>
      <div className="flex items-center gap-2">
        <span className={clsx('w-2 h-2 rounded-full shrink-0', style.dot)} />
        <KindIcon className="w-3.5 h-3.5 text-ptt-text shrink-0" />
        <span className="font-rajdhani font-semibold text-sm text-white truncate flex-1">
          {sensor.name}
        </span>
        <span className={clsx('font-mono text-[10px] tracking-widest', style.label)}>
          {sensor.status}
        </span>
      </div>
      <div className="flex items-center gap-4 mt-1 pl-4 font-mono text-xs">
        <span className="flex items-center gap-1 text-white/80">
          <Thermometer className="w-3 h-3 text-ptt-text" />
          {fmt(sensor.temperature, '°C')}
        </span>
        {sensor.humidity != null && (
          <span className="flex items-center gap-1 text-white/80">
            <Droplets className="w-3 h-3 text-ptt-blue" />
            {fmt(sensor.humidity, '%')}
          </span>
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
  const list = Object.values(sensors).sort((a, b) => a.name.localeCompare(b.name));

  if (list.length === 0) return null;

  const alerting = list.filter((s) => s.status === 'ALERT' || s.status === 'STALE').length;

  return (
    <div className="border-t border-ptt-border bg-ptt-dark">
      <div className="px-3 py-2 flex items-center gap-2">
        <Thermometer className="w-3 h-3 text-ptt-text" />
        <p className="font-mono text-ptt-text text-xs tracking-widest">SENSORS</p>
        <span className={clsx('ml-auto font-mono text-xs', alerting > 0 ? 'text-ptt-danger' : 'text-ptt-green')}>
          {alerting > 0 ? `${alerting} ALERT` : 'ALL OK'}
        </span>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {list.map((sensor) => (
          <SensorCard key={sensor.id} sensor={sensor} />
        ))}
      </div>
    </div>
  );
}
