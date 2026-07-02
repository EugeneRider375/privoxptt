import { useEffect, useState } from 'react';
import {
  Plus, Trash2, X, ChevronDown, Refrigerator, Home, TreePine, Radio, Globe, KeyRound, Copy,
} from 'lucide-react';
import { sensorsApi, groupsApi, orgsApi } from '@/api/client';
import { useStore } from '@/store/useStore';
import type { Sensor, SensorRule, SensorSeverity, Group, Organization } from '@/types';
import clsx from 'clsx';

const inputCls = 'w-full bg-ptt-dark border border-ptt-border rounded px-2 py-1.5 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';
// без w-full — для flex-полей в редакторе правил (иначе схлопываются)
const fieldCls = 'bg-ptt-dark border border-ptt-border rounded px-2 py-1.5 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';

const KIND_ICON = { FRIDGE: Refrigerator, INDOOR: Home, OUTDOOR: TreePine } as const;
const STATUS_DOT: Record<Sensor['status'], string> = {
  OK: 'bg-ptt-green', ALERT: 'bg-ptt-danger animate-pulse', STALE: 'bg-ptt-muted',
};
const SEV_COLOR: Record<SensorSeverity, string> = {
  INFO: 'text-ptt-blue', WARNING: 'text-ptt-warn', CRITICAL: 'text-ptt-danger',
};
const METRIC_SUGGEST = ['temperature', 'humidity', 'waterLevel', 'leak', 'motion', 'doorOpen', 'co2', 'battery', 'rssi', 'pressure'];
const UNIT: Record<string, string> = { temperature: '°C', humidity: '%', co2: 'ppm', battery: '%' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="font-mono text-ptt-muted text-xs tracking-widest block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card w-full max-w-lg p-4 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="font-orbitron text-white text-sm tracking-widest">{title}</p>
          <button onClick={onClose} className="text-ptt-muted hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// thresholds (массив правил ИЛИ старый объект) → массив правил для редактора
function toRules(thresholds: Sensor['thresholds']): SensorRule[] {
  if (Array.isArray(thresholds)) return thresholds;
  const out: SensorRule[] = [];
  for (const [metric, r] of Object.entries(thresholds ?? {})) {
    const hasMin = typeof r?.min === 'number';
    const hasMax = typeof r?.max === 'number';
    if (hasMin && hasMax) out.push({ id: metric, metric, op: 'outside', min: r.min, max: r.max, severity: 'CRITICAL' });
    else if (hasMax) out.push({ id: metric, metric, op: 'gt', value: r.max, severity: 'CRITICAL' });
    else if (hasMin) out.push({ id: metric, metric, op: 'lt', value: r.min, severity: 'CRITICAL' });
  }
  return out;
}

function fmtMetrics(v: Sensor['lastValue']): string {
  if (!v) return '—';
  const parts = Object.entries(v).map(([k, val]) => {
    if (typeof val === 'boolean') return `${k}: ${val ? 'yes' : 'no'}`;
    const u = UNIT[k] ?? '';
    return `${k} ${val}${u}`;
  });
  return parts.join('  ·  ') || '—';
}

const newId = () => Math.random().toString(36).slice(2, 8);

// ── Редактор правил ──
function RulesEditor({ rules, onChange }: { rules: SensorRule[]; onChange: (r: SensorRule[]) => void }) {
  const update = (i: number, patch: Partial<SensorRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s));

  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={r.id} className="bg-ptt-dark border border-ptt-border/50 rounded p-2 space-y-1.5">
          <div className="flex gap-1.5 items-center">
            <input list="metric-suggest" placeholder="metric" value={r.metric}
              onChange={(e) => update(i, { metric: e.target.value })} className={clsx(fieldCls, 'flex-1 min-w-0')} />
            <select value={r.op} onChange={(e) => {
              const op = e.target.value as SensorRule['op'];
              // 'is' показывает дефолт «true», но без onChange он не сохраняется → засеваем явно.
              // При уходе с 'is' чистим булев value, чтобы числовое поле не подхватило его.
              if (op === 'is') update(i, { op, value: typeof r.value === 'boolean' ? r.value : true });
              else update(i, { op, value: typeof r.value === 'boolean' ? undefined : r.value });
            }} className={clsx(fieldCls, 'shrink-0 w-20')}>
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
              <option value="outside">вне</option>
              <option value="is">да/нет</option>
            </select>
            <button onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
              className="text-ptt-muted hover:text-ptt-danger shrink-0 px-1"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex gap-1.5 items-center">
            {r.op === 'outside' ? (
              <>
                <input type="number" placeholder="min" value={r.min ?? ''} onChange={(e) => update(i, { min: numOrUndef(e.target.value) })} className={clsx(fieldCls, 'flex-1 min-w-0')} />
                <input type="number" placeholder="max" value={r.max ?? ''} onChange={(e) => update(i, { max: numOrUndef(e.target.value) })} className={clsx(fieldCls, 'flex-1 min-w-0')} />
              </>
            ) : r.op === 'is' ? (
              <select value={String(r.value ?? true)} onChange={(e) => update(i, { value: e.target.value === 'true' })} className={clsx(fieldCls, 'flex-1 min-w-0')}>
                <option value="true">true (да)</option>
                <option value="false">false (нет)</option>
              </select>
            ) : (
              <input type="number" placeholder="value" value={typeof r.value === 'number' ? r.value : ''} onChange={(e) => update(i, { value: numOrUndef(e.target.value) })} className={clsx(fieldCls, 'flex-1 min-w-0')} />
            )}
            <select value={r.severity ?? 'CRITICAL'} onChange={(e) => update(i, { severity: e.target.value as SensorSeverity })}
              className={clsx(fieldCls, 'shrink-0 w-28', SEV_COLOR[r.severity ?? 'CRITICAL'])}>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
        </div>
      ))}
      <button onClick={() => onChange([...rules, { id: newId(), metric: '', op: 'gt', severity: 'CRITICAL' }])}
        className="flex items-center gap-1 text-ptt-blue hover:text-white font-mono text-xs">
        <Plus className="w-3 h-3" /> add rule
      </button>
      <datalist id="metric-suggest">{METRIC_SUGGEST.map((m) => <option key={m} value={m} />)}</datalist>
    </div>
  );
}

function KeyBox({ sensorKey, onRotate }: { sensorKey: string; onRotate?: () => void }) {
  const url = `${window.location.origin}/api/telemetry`;
  return (
    <div className="bg-ptt-dark border border-ptt-blue/40 rounded p-2 space-y-1.5 font-mono text-xs">
      <div className="flex items-center gap-1 text-ptt-blue"><KeyRound className="w-3 h-3" /> PUSH DEVICE — зашить в устройство:</div>
      <div className="flex items-center gap-1">
        <span className="text-ptt-muted shrink-0">URL:</span>
        <span className="text-white/80 truncate flex-1">{url}</span>
        <button onClick={() => navigator.clipboard?.writeText(url)} className="text-ptt-muted hover:text-white"><Copy className="w-3 h-3" /></button>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-ptt-muted shrink-0">X-Sensor-Key:</span>
        <span className="text-ptt-green truncate flex-1">{sensorKey}</span>
        <button onClick={() => navigator.clipboard?.writeText(sensorKey)} className="text-ptt-muted hover:text-white"><Copy className="w-3 h-3" /></button>
      </div>
      {onRotate && (
        <button onClick={onRotate} className="text-ptt-warn hover:text-white text-[11px]">↻ сгенерировать новый ключ</button>
      )}
    </div>
  );
}

export function AdminSensors() {
  const currentUser = useStore((s) => s.user);
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN';

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [edit, setEdit] = useState({ name: '', groupId: '', enabled: true, alarmSound: false, reportIntervalSec: '', sensorKey: '', rules: [] as SensorRule[] });

  const [createOpen, setCreateOpen] = useState(false);
  const emptyCreate = {
    ingest: 'PUSH' as 'PUSH' | 'PULL',
    name: '', kind: 'FRIDGE', organizationId: '', groupId: '',
    adapter: 'FRIGO', sourceUrl: '', externalId: '', reportIntervalSec: '',
    sensorKey: '',
    alarmSound: false,
    rules: [] as SensorRule[],
  };
  const [create, setCreate] = useState(emptyCreate);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    const org = isSuperAdmin ? selectedOrgId || undefined : undefined;
    sensorsApi.list(org).then(setSensors).catch(console.error);
    groupsApi.list(org).then(setGroups).catch(console.error);
  };

  useEffect(() => { if (isSuperAdmin) orgsApi.list().then(setOrgs).catch(console.error); }, [isSuperAdmin]);
  useEffect(() => { load(); }, [selectedOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleExpand(s: Sensor) {
    if (expandedId === s.id) { setExpandedId(null); return; }
    setExpandedId(s.id);
    setError('');
    setEdit({
      name: s.name,
      groupId: s.groupId ?? '',
      enabled: s.enabled,
      alarmSound: s.alarmSound ?? false,
      reportIntervalSec: s.reportIntervalSec?.toString() ?? '',
      sensorKey: '',
      rules: toRules(s.thresholds),
    });
  }

  async function handleSaveEdit(s: Sensor) {
    setLoading(true); setError('');
    try {
      await sensorsApi.update(s.id, {
        name: edit.name,
        groupId: edit.groupId || null,
        enabled: edit.enabled,
        alarmSound: edit.alarmSound,
        reportIntervalSec: edit.reportIntervalSec.trim() === '' ? null : Number(edit.reportIntervalSec),
        thresholds: edit.rules,
        sensorKey: edit.sensorKey.trim() || undefined, // непусто — сменить ключ; пусто — не трогать
      });
      setExpandedId(null);
      load();
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Error'); } finally { setLoading(false); }
  }

  async function handleRotate(s: Sensor) {
    const r = await sensorsApi.rotateKey(s.id).catch(() => null);
    if (r?.sensorKey) load();
  }

  async function handleDelete(s: Sensor) {
    if (!confirm(`Delete sensor "${s.name}"?`)) return;
    await sensorsApi.delete(s.id).catch(console.error);
    load();
  }

  function openCreate() {
    setCreate({ ...emptyCreate, organizationId: selectedOrgId || orgs[0]?.id || '' });
    setCreatedKey(null);
    setError('');
    setCreateOpen(true);
  }

  async function handleCreate() {
    setLoading(true); setError('');
    try {
      const payload: any = {
        name: create.name,
        kind: create.kind,
        ingest: create.ingest,
        organizationId: create.organizationId || undefined,
        groupId: create.groupId || undefined,
        reportIntervalSec: create.reportIntervalSec.trim() === '' ? undefined : Number(create.reportIntervalSec),
        alarmSound: create.alarmSound,
        thresholds: create.rules,
      };
      if (create.ingest === 'PULL') {
        payload.adapter = create.adapter;
        payload.sourceUrl = create.sourceUrl;
        payload.externalId = create.externalId || undefined;
      }
      if (create.ingest === 'PUSH' && create.sensorKey.trim()) {
        payload.sensorKey = create.sensorKey.trim();
      }
      const s: Sensor = await sensorsApi.create(payload);
      load();
      if (create.ingest === 'PUSH' && s.sensorKey) {
        setCreatedKey(s.sensorKey); // показать ключ, не закрывать
      } else {
        setCreateOpen(false);
      }
    } catch (e: any) { setError(e?.response?.data?.error ?? 'Error'); } finally { setLoading(false); }
  }

  const createGroups = groups.filter((g) => !create.organizationId || g.organizationId === create.organizationId);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-white text-base tracking-wider">SENSORS</h2>
        {isSuperAdmin && (
          <button onClick={openCreate} className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest hover:bg-ptt-green/90">
            <Plus className="w-3 h-3" /> ADD
          </button>
        )}
      </div>

      {isSuperAdmin && (
        <div className="card p-3">
          <label className="font-mono text-ptt-muted text-xs tracking-widest block mb-1">ORGANIZATION</label>
          <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className={inputCls}>
            <option value="">All organizations</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.slug}</option>)}
          </select>
        </div>
      )}

      <div className="space-y-2">
        {sensors.map((s) => {
          const KindIcon = KIND_ICON[s.kind] ?? Home;
          const open = expandedId === s.id;
          return (
            <div key={s.id} className="card overflow-hidden">
              <button onClick={() => toggleExpand(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ptt-muted/10 transition-colors">
                <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', STATUS_DOT[s.status])} />
                <KindIcon className="w-4 h-4 text-ptt-text shrink-0" />
                {s.ingest === 'PUSH' ? <Radio className="w-3 h-3 text-ptt-blue shrink-0" /> : <Globe className="w-3 h-3 text-ptt-muted shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-rajdhani font-bold text-white truncate">{s.name}</p>
                  <p className="font-mono text-ptt-muted text-xs truncate">
                    {s.group?.name ?? 'no group'}{!s.enabled && ' · OFF'}
                    {s.batteryPct != null && ` · 🔋${s.batteryPct}%`}
                    {isSuperAdmin && s.organization && ` · ${s.organization.name}`}
                  </p>
                </div>
                <span className="font-mono text-xs text-white/70 shrink-0 hidden sm:block truncate max-w-[40%]">{fmtMetrics(s.lastValue)}</span>
                <span className={clsx('font-mono text-[10px] tracking-widest shrink-0',
                  s.status === 'ALERT' ? 'text-ptt-danger' : s.status === 'STALE' ? 'text-ptt-muted' : 'text-ptt-green')}>{s.status}</span>
                <ChevronDown className={clsx('w-4 h-4 text-ptt-muted shrink-0 transition-transform', open && 'rotate-180')} />
              </button>

              {open && (
                <div className="px-4 pb-4 pt-1 border-t border-ptt-border/50 space-y-3">
                  <Field label="NAME">
                    <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="GROUP (alerts / push target)">
                    <select value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })} className={inputCls}>
                      <option value="">— no group —</option>
                      {groups.filter((g) => g.organizationId === s.organizationId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </Field>

                  <Field label="THRESHOLD RULES (metric · condition · severity)">
                    <RulesEditor rules={edit.rules} onChange={(rules) => setEdit({ ...edit, rules })} />
                  </Field>

                  <div className="grid grid-cols-2 gap-2 items-end">
                    <Field label="EXPECTED REPORT INTERVAL (sec — для офлайн-детекта)">
                      <input type="number" placeholder="напр. 600" value={edit.reportIntervalSec} onChange={(e) => setEdit({ ...edit, reportIntervalSec: e.target.value })} className={inputCls} />
                    </Field>
                    <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                      <input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} className="accent-ptt-green" />
                      <span className="font-mono text-xs text-ptt-text">Sensor enabled</span>
                    </label>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={edit.alarmSound} onChange={(e) => setEdit({ ...edit, alarmSound: e.target.checked })} className="accent-ptt-danger" />
                    <span className="font-mono text-xs text-ptt-text">🔊 Звуковая сирена диспетчеру при тревоге</span>
                  </label>

                  {s.ingest === 'PUSH' && s.sensorKey && (
                    <>
                      <KeyBox sensorKey={s.sensorKey} onRotate={isSuperAdmin ? () => handleRotate(s) : undefined} />
                      {isSuperAdmin && (
                        <Field label="SET KEY (впиши ключ устройства — вернуть датчик без перепрошивки)">
                          <input value={edit.sensorKey} onChange={(e) => setEdit({ ...edit, sensorKey: e.target.value })} placeholder="оставь пустым — ключ не менять" className={inputCls} />
                        </Field>
                      )}
                    </>
                  )}
                  {s.ingest === 'PULL' && <p className="font-mono text-ptt-muted text-[10px] truncate">{s.adapter} · {s.sourceUrl}</p>}

                  {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleSaveEdit(s)} disabled={loading} className="flex-1 bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50">
                      {loading ? 'SAVING...' : 'SAVE'}
                    </button>
                    {isSuperAdmin && (
                      <button onClick={() => handleDelete(s)} className="px-3 py-2 border border-ptt-danger/50 text-ptt-danger rounded hover:bg-ptt-danger/10"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {sensors.length === 0 && <p className="font-mono text-ptt-muted text-xs text-center py-6">NO SENSORS</p>}
      </div>

      {createOpen && (
        <Modal title="NEW SENSOR" onClose={() => setCreateOpen(false)}>
          {createdKey ? (
            <div className="space-y-3">
              <p className="font-mono text-ptt-green text-xs">✓ Push-датчик создан. Сохрани ключ — он понадобится для устройства:</p>
              <KeyBox sensorKey={createdKey} />
              <button onClick={() => setCreateOpen(false)} className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest">DONE</button>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="CONNECTION TYPE">
                <div className="flex gap-2">
                  {(['PUSH', 'PULL'] as const).map((t) => (
                    <button key={t} onClick={() => setCreate({ ...create, ingest: t })}
                      className={clsx('flex-1 py-1.5 rounded border font-mono text-xs', create.ingest === t ? 'border-ptt-green bg-ptt-green/10 text-ptt-green' : 'border-ptt-border text-ptt-muted')}>
                      {t === 'PUSH' ? '📡 Push-устройство' : '🌐 Pull-источник'}
                    </button>
                  ))}
                </div>
              </Field>
              {isSuperAdmin && (
                <Field label="ORGANIZATION">
                  <select value={create.organizationId} onChange={(e) => setCreate({ ...create, organizationId: e.target.value })} className={inputCls}>
                    <option value="">- select organization -</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.slug}</option>)}
                  </select>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="NAME"><input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} className={inputCls} /></Field>
                <Field label="KIND">
                  <select value={create.kind} onChange={(e) => setCreate({ ...create, kind: e.target.value })} className={inputCls}>
                    <option value="FRIDGE">FRIDGE</option><option value="INDOOR">INDOOR</option><option value="OUTDOOR">OUTDOOR</option>
                  </select>
                </Field>
              </div>
              {create.ingest === 'PUSH' && (
                <Field label="SENSOR KEY (пусто — сгенерится авто; или впиши ключ устройства)">
                  <input value={create.sensorKey} onChange={(e) => setCreate({ ...create, sensorKey: e.target.value })} placeholder="оставь пустым для авто-генерации" className={inputCls} />
                </Field>
              )}
              {create.ingest === 'PULL' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="ADAPTER">
                      <select value={create.adapter} onChange={(e) => setCreate({ ...create, adapter: e.target.value })} className={inputCls}>
                        <option value="FRIGO">FRIGO</option><option value="HOMECLIMATE">HOMECLIMATE</option>
                      </select>
                    </Field>
                    <Field label="EXTERNAL ID (опц.)"><input value={create.externalId} onChange={(e) => setCreate({ ...create, externalId: e.target.value })} className={inputCls} /></Field>
                  </div>
                  <Field label="SOURCE URL"><input value={create.sourceUrl} placeholder="https://..." onChange={(e) => setCreate({ ...create, sourceUrl: e.target.value })} className={inputCls} /></Field>
                </>
              )}
              <Field label="GROUP (alerts / push)">
                <select value={create.groupId} onChange={(e) => setCreate({ ...create, groupId: e.target.value })} className={inputCls}>
                  <option value="">— no group —</option>
                  {createGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
              <Field label="THRESHOLD RULES">
                <RulesEditor rules={create.rules} onChange={(rules) => setCreate({ ...create, rules })} />
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={create.alarmSound} onChange={(e) => setCreate({ ...create, alarmSound: e.target.checked })} className="accent-ptt-danger" />
                <span className="font-mono text-xs text-ptt-text">🔊 Звуковая сирена диспетчеру при тревоге</span>
              </label>
              {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
              <button onClick={handleCreate} disabled={loading} className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50">
                {loading ? 'SAVING...' : 'CREATE'}
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
