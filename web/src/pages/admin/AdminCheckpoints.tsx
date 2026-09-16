import { useEffect, useState } from 'react';
import { Plus, Trash2, X, ChevronDown, MapPin, Download, Copy, Crosshair } from 'lucide-react';
import { checkpointsApi, groupsApi } from '@/api/client';
import { QrCode, downloadQr } from '@/components/ui/QrCode';
import type { Checkpoint, CheckpointVisit, Group } from '@/types';
import clsx from 'clsx';

const inputCls = 'w-full bg-ptt-dark border border-ptt-border rounded px-2 py-1.5 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';

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

/**
 * D49.2 — "Guard Tour лайт": печатаем один QR на контрольную точку обхода
 * (дверь, щит и т.п.), сотрудник сканирует его обычной камерой телефона во
 * время обхода. См. checkpoints.ts на сервере — та же идея, что и у
 * приглашений по QR, только вместо онбординга — просто отметка присутствия.
 */
export function AdminCheckpoints() {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visits, setVisits] = useState<CheckpointVisit[]>([]);
  const [visitsLoading, setVisitsLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const emptyCreate = { name: '', groupId: '', lat: '', lng: '' };
  const [create, setCreate] = useState(emptyCreate);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    checkpointsApi.list().then(setCheckpoints).catch(console.error);
    groupsApi.list().then(setGroups).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  function toggleExpand(c: Checkpoint) {
    if (expandedId === c.id) { setExpandedId(null); return; }
    setExpandedId(c.id);
    setVisits([]);
    setVisitsLoading(true);
    checkpointsApi.visits(c.id).then(setVisits).catch(console.error).finally(() => setVisitsLoading(false));
  }

  function openCreate() {
    setCreate(emptyCreate);
    setError('');
    setCreateOpen(true);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCreate((c) => ({ ...c, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  }

  async function handleCreate() {
    if (!create.name.trim()) { setError('Name is required'); return; }
    setLoading(true); setError('');
    try {
      await checkpointsApi.create({
        name: create.name.trim(),
        groupId: create.groupId || undefined,
        lat: create.lat.trim() === '' ? undefined : Number(create.lat),
        lng: create.lng.trim() === '' ? undefined : Number(create.lng),
      });
      setCreateOpen(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(c: Checkpoint) {
    if (!confirm(`Delete checkpoint "${c.name}"? Visit history will be lost.`)) return;
    await checkpointsApi.delete(c.id).catch(console.error);
    if (expandedId === c.id) setExpandedId(null);
    load();
  }

  function groupName(id?: string): string {
    return groups.find((g) => g.id === id)?.name ?? '';
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-white text-base tracking-wider">CHECKPOINTS</h2>
        <button onClick={openCreate} className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest hover:bg-ptt-green/90">
          <Plus className="w-3 h-3" /> ADD
        </button>
      </div>

      <p className="font-mono text-ptt-muted text-xs">
        Печатаете QR один раз, клеите на месте — сотрудник сканирует обычной камерой телефона во время обхода.
      </p>

      <div className="space-y-2">
        {checkpoints.length === 0 && (
          <p className="font-mono text-ptt-muted text-sm">No checkpoints yet.</p>
        )}
        {checkpoints.map((c) => {
          const open = expandedId === c.id;
          return (
            <div key={c.id} className="card overflow-hidden">
              <button onClick={() => toggleExpand(c)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ptt-muted/10 transition-colors">
                <MapPin className="w-4 h-4 text-ptt-text shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-rajdhani font-bold text-white truncate">{c.name}</p>
                  <p className="font-mono text-ptt-muted text-xs truncate">
                    {groupName(c.groupId) || 'no group'} · {c.visitCount} {c.visitCount === 1 ? 'visit' : 'visits'}
                  </p>
                </div>
                <ChevronDown className={clsx('w-4 h-4 text-ptt-muted shrink-0 transition-transform', open && 'rotate-180')} />
              </button>

              {open && (
                <div className="px-4 pb-4 pt-1 border-t border-ptt-border/50 space-y-4">
                  <div className="flex items-start gap-4">
                    <QrCode value={c.visitUrl} size={120} alt={`QR for ${c.name}`} />
                    <div className="flex-1 min-w-0 space-y-2">
                      <button
                        onClick={() => downloadQr(c.visitUrl, `checkpoint-${c.name}`)}
                        className="flex items-center gap-1.5 font-mono text-xs text-ptt-blue hover:text-white"
                      >
                        <Download className="w-3.5 h-3.5" /> Download QR
                      </button>
                      <button
                        onClick={() => navigator.clipboard.writeText(c.visitUrl)}
                        className="flex items-center gap-1.5 font-mono text-xs text-ptt-muted hover:text-white"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy link
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="flex items-center gap-1.5 font-mono text-xs text-ptt-danger hover:text-white"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete checkpoint
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="font-mono text-ptt-muted text-xs tracking-widest mb-1.5">RECENT VISITS</p>
                    {visitsLoading && <p className="font-mono text-ptt-muted text-xs">Loading…</p>}
                    {!visitsLoading && visits.length === 0 && (
                      <p className="font-mono text-ptt-muted text-xs">No visits recorded yet.</p>
                    )}
                    {!visitsLoading && visits.length > 0 && (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {visits.map((v) => (
                          <div key={v.id} className="flex items-center justify-between font-mono text-xs text-ptt-text">
                            <span className="callsign">{v.callsign}</span>
                            <span className="text-ptt-muted">{new Date(v.timestamp).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {createOpen && (
        <Modal title="NEW CHECKPOINT" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <Field label="NAME">
              <input
                value={create.name}
                onChange={(e) => setCreate({ ...create, name: e.target.value })}
                placeholder="e.g. Back door, Warehouse 5"
                className={inputCls}
                autoFocus
              />
            </Field>
            <Field label="GROUP (optional)">
              <select value={create.groupId} onChange={(e) => setCreate({ ...create, groupId: e.target.value })} className={inputCls}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="COORDINATES (optional — for the dispatcher map, not required for scanning to work)">
              <div className="flex gap-2">
                <input value={create.lat} onChange={(e) => setCreate({ ...create, lat: e.target.value })} placeholder="lat" className={inputCls} />
                <input value={create.lng} onChange={(e) => setCreate({ ...create, lng: e.target.value })} placeholder="lng" className={inputCls} />
                <button
                  onClick={useMyLocation}
                  disabled={locating}
                  title="Use my current location"
                  className="shrink-0 px-2 border border-ptt-border rounded text-ptt-muted hover:text-white disabled:opacity-50"
                >
                  <Crosshair className="w-4 h-4" />
                </button>
              </div>
            </Field>
            {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest hover:bg-ptt-green/90 disabled:opacity-50"
            >
              {loading ? 'CREATING…' : 'CREATE'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
