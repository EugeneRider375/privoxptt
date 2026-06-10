import { useEffect, useState } from 'react';
import {
  Plus, Trash2, X, ChevronDown, Thermometer, Droplets,
  Refrigerator, Home, TreePine,
} from 'lucide-react';
import { sensorsApi, groupsApi, orgsApi } from '@/api/client';
import { useStore } from '@/store/useStore';
import type { Sensor, Group, Organization } from '@/types';
import clsx from 'clsx';

const inputCls = 'w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';

const KIND_ICON = { FRIDGE: Refrigerator, INDOOR: Home, OUTDOOR: TreePine } as const;
const STATUS_DOT: Record<Sensor['status'], string> = {
  OK: 'bg-ptt-green', ALERT: 'bg-ptt-danger animate-pulse', STALE: 'bg-ptt-muted',
};

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
      <div className="card w-full max-w-md p-4 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="font-orbitron text-white text-sm tracking-widest">{title}</p>
          <button onClick={onClose} className="text-ptt-muted hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// thresholds JSON ↔ поля формы
type ThreshForm = { tempMin: string; tempMax: string; humMax: string };
function thresholdsToForm(t: Sensor['thresholds']): ThreshForm {
  return {
    tempMin: t?.temperature?.min?.toString() ?? '',
    tempMax: t?.temperature?.max?.toString() ?? '',
    humMax: t?.humidity?.max?.toString() ?? '',
  };
}
function formToThresholds(f: ThreshForm): Sensor['thresholds'] {
  const out: Sensor['thresholds'] = {};
  const tMin = f.tempMin.trim() === '' ? undefined : Number(f.tempMin);
  const tMax = f.tempMax.trim() === '' ? undefined : Number(f.tempMax);
  if (tMin !== undefined || tMax !== undefined) {
    out.temperature = {};
    if (tMin !== undefined) out.temperature.min = tMin;
    if (tMax !== undefined) out.temperature.max = tMax;
  }
  const hMax = f.humMax.trim() === '' ? undefined : Number(f.humMax);
  if (hMax !== undefined) out.humidity = { max: hMax };
  return out;
}

function fmtValue(s: Sensor): string {
  const t = s.lastValue?.temperature;
  const h = s.lastValue?.humidity;
  const parts: string[] = [];
  if (t != null) parts.push(`${t.toFixed(1)}°C`);
  if (h != null) parts.push(`${h.toFixed(0)}%`);
  return parts.join('  ') || '—';
}

export function AdminSensors() {
  const currentUser = useStore((s) => s.user);
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN';

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // форма редактирования (на раскрытый датчик)
  const [edit, setEdit] = useState({ name: '', groupId: '', enabled: true, thr: { tempMin: '', tempMax: '', humMax: '' } as ThreshForm });

  // форма создания (суперадмин)
  const [createOpen, setCreateOpen] = useState(false);
  const [create, setCreate] = useState({
    name: '', kind: 'FRIDGE', adapter: 'FRIGO', sourceUrl: '', externalId: '',
    organizationId: '', groupId: '', thr: { tempMin: '', tempMax: '', humMax: '' } as ThreshForm,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    const org = isSuperAdmin ? selectedOrgId || undefined : undefined;
    sensorsApi.list(org).then(setSensors).catch(console.error);
    groupsApi.list(org).then(setGroups).catch(console.error);
  };

  useEffect(() => {
    if (isSuperAdmin) orgsApi.list().then(setOrgs).catch(console.error);
  }, [isSuperAdmin]);

  useEffect(() => { load(); }, [selectedOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleExpand(s: Sensor) {
    if (expandedId === s.id) { setExpandedId(null); return; }
    setExpandedId(s.id);
    setError('');
    setEdit({
      name: s.name,
      groupId: s.groupId ?? '',
      enabled: s.enabled,
      thr: thresholdsToForm(s.thresholds),
    });
  }

  async function handleSaveEdit(s: Sensor) {
    setLoading(true); setError('');
    try {
      await sensorsApi.update(s.id, {
        name: edit.name,
        groupId: edit.groupId || null,
        enabled: edit.enabled,
        thresholds: formToThresholds(edit.thr),
      });
      setExpandedId(null);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Error');
    } finally { setLoading(false); }
  }

  async function handleDelete(s: Sensor) {
    if (!confirm(`Delete sensor "${s.name}"?`)) return;
    await sensorsApi.delete(s.id).catch(console.error);
    load();
  }

  function openCreate() {
    setCreate({
      name: '', kind: 'FRIDGE', adapter: 'FRIGO', sourceUrl: '', externalId: '',
      organizationId: selectedOrgId || orgs[0]?.id || '', groupId: '',
      thr: { tempMin: '', tempMax: '', humMax: '' },
    });
    setError('');
    setCreateOpen(true);
  }

  async function handleCreate() {
    setLoading(true); setError('');
    try {
      await sensorsApi.create({
        name: create.name,
        kind: create.kind,
        adapter: create.adapter,
        sourceUrl: create.sourceUrl,
        externalId: create.externalId || undefined,
        organizationId: create.organizationId || undefined,
        groupId: create.groupId || undefined,
        thresholds: formToThresholds(create.thr),
      });
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Error');
    } finally { setLoading(false); }
  }

  // группы для селекта в форме создания (по выбранной орг)
  const createGroups = groups.filter((g) => !create.organizationId || g.organizationId === create.organizationId);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-white text-base tracking-wider">SENSORS</h2>
        {isSuperAdmin && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest hover:bg-ptt-green/90">
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
          const KindIcon = KIND_ICON[s.kind];
          const open = expandedId === s.id;
          return (
            <div key={s.id} className="card overflow-hidden">
              {/* строка датчика */}
              <button onClick={() => toggleExpand(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ptt-muted/10 transition-colors">
                <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', STATUS_DOT[s.status])} />
                <KindIcon className="w-4 h-4 text-ptt-text shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-rajdhani font-bold text-white truncate">{s.name}</p>
                  <p className="font-mono text-ptt-muted text-xs truncate">
                    {s.group?.name ?? 'no group'}{!s.enabled && ' · OFF'}
                    {isSuperAdmin && s.organization && ` · ${s.organization.name}`}
                  </p>
                </div>
                <span className="font-mono text-sm text-white/80 shrink-0">{fmtValue(s)}</span>
                <span className={clsx('font-mono text-[10px] tracking-widest shrink-0',
                  s.status === 'ALERT' ? 'text-ptt-danger' : s.status === 'STALE' ? 'text-ptt-muted' : 'text-ptt-green')}>
                  {s.status}
                </span>
                <ChevronDown className={clsx('w-4 h-4 text-ptt-muted shrink-0 transition-transform', open && 'rotate-180')} />
              </button>

              {/* выпадающая панель настроек */}
              {open && (
                <div className="px-4 pb-4 pt-1 border-t border-ptt-border/50 space-y-3">
                  <Field label="NAME">
                    <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="GROUP (alerts / push target)">
                    <select value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })} className={inputCls}>
                      <option value="">— no group —</option>
                      {groups.filter((g) => g.organizationId === s.organizationId).map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </Field>

                  <div>
                    <label className="font-mono text-ptt-muted text-xs tracking-widest block mb-1 flex items-center gap-1">
                      <Thermometer className="w-3 h-3" /> TEMPERATURE — thresholds °C
                    </label>
                    <div className="flex gap-2">
                      <input placeholder="min" type="number" value={edit.thr.tempMin}
                        onChange={(e) => setEdit({ ...edit, thr: { ...edit.thr, tempMin: e.target.value } })} className={inputCls} />
                      <input placeholder="max" type="number" value={edit.thr.tempMax}
                        onChange={(e) => setEdit({ ...edit, thr: { ...edit.thr, tempMax: e.target.value } })} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="font-mono text-ptt-muted text-xs tracking-widest mb-1 flex items-center gap-1">
                      <Droplets className="w-3 h-3" /> HUMIDITY — max threshold %
                    </label>
                    <input placeholder="max %" type="number" value={edit.thr.humMax}
                      onChange={(e) => setEdit({ ...edit, thr: { ...edit.thr, humMax: e.target.value } })} className={inputCls} />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={edit.enabled}
                      onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} className="accent-ptt-green" />
                    <span className="font-mono text-xs text-ptt-text">Sensor enabled</span>
                  </label>

                  {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}

                  <div className="flex items-center gap-2">
                    <button onClick={() => handleSaveEdit(s)} disabled={loading}
                      className="flex-1 bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50">
                      {loading ? 'SAVING...' : 'SAVE'}
                    </button>
                    {isSuperAdmin && (
                      <button onClick={() => handleDelete(s)}
                        className="px-3 py-2 border border-ptt-danger/50 text-ptt-danger rounded hover:bg-ptt-danger/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="font-mono text-ptt-muted text-[10px] truncate">{s.adapter} · {s.sourceUrl}</p>
                </div>
              )}
            </div>
          );
        })}
        {sensors.length === 0 && (
          <p className="font-mono text-ptt-muted text-xs text-center py-6">NO SENSORS</p>
        )}
      </div>

      {/* Создать датчик (суперадмин) */}
      {createOpen && (
        <Modal title="NEW SENSOR" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            {isSuperAdmin && (
              <Field label="ORGANIZATION">
                <select value={create.organizationId} onChange={(e) => setCreate({ ...create, organizationId: e.target.value })} className={inputCls}>
                  <option value="">- select organization -</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.slug}</option>)}
                </select>
              </Field>
            )}
            <Field label="NAME">
              <input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="KIND">
                <select value={create.kind} onChange={(e) => setCreate({ ...create, kind: e.target.value })} className={inputCls}>
                  <option value="FRIDGE">FRIDGE</option>
                  <option value="INDOOR">INDOOR</option>
                  <option value="OUTDOOR">OUTDOOR</option>
                </select>
              </Field>
              <Field label="ADAPTER">
                <select value={create.adapter} onChange={(e) => setCreate({ ...create, adapter: e.target.value })} className={inputCls}>
                  <option value="FRIGO">FRIGO</option>
                  <option value="HOMECLIMATE">HOMECLIMATE</option>
                </select>
              </Field>
            </div>
            <Field label="SOURCE URL">
              <input value={create.sourceUrl} placeholder="https://..." onChange={(e) => setCreate({ ...create, sourceUrl: e.target.value })} className={inputCls} />
            </Field>
            <Field label="EXTERNAL ID (HomeClimate sensor_id, optional)">
              <input value={create.externalId} onChange={(e) => setCreate({ ...create, externalId: e.target.value })} className={inputCls} />
            </Field>
            <Field label="GROUP (alerts / push)">
              <select value={create.groupId} onChange={(e) => setCreate({ ...create, groupId: e.target.value })} className={inputCls}>
                <option value="">— no group —</option>
                {createGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="TEMP min °C">
                <input type="number" value={create.thr.tempMin} onChange={(e) => setCreate({ ...create, thr: { ...create.thr, tempMin: e.target.value } })} className={inputCls} />
              </Field>
              <Field label="TEMP max °C">
                <input type="number" value={create.thr.tempMax} onChange={(e) => setCreate({ ...create, thr: { ...create.thr, tempMax: e.target.value } })} className={inputCls} />
              </Field>
            </div>
            <Field label="HUMIDITY max %">
              <input type="number" value={create.thr.humMax} onChange={(e) => setCreate({ ...create, thr: { ...create.thr, humMax: e.target.value } })} className={inputCls} />
            </Field>
            {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
            <button onClick={handleCreate} disabled={loading}
              className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50">
              {loading ? 'SAVING...' : 'CREATE'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
