import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Building2 } from 'lucide-react';
import { orgsApi } from '@/api/client';
import type { Organization } from '@/types';

const inputCls = 'w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';

export function AdminOrgs() {
  const [orgs, setOrgs] = useState<(Organization & { _count?: { users: number; groups: number } })[]>([]);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => orgsApi.list().then(setOrgs).catch(console.error);
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ name: '', slug: '', description: '' });
    setError('');
    setModal('create');
  }

  function openEdit(o: Organization) {
    setSelected(o);
    setForm({ name: o.name, slug: o.slug, description: '' });
    setError('');
    setModal('edit');
  }

  async function handleSave() {
    setLoading(true);
    setError('');
    try {
      if (modal === 'create') await orgsApi.create(form);
      else if (modal === 'edit' && selected) await orgsApi.update(selected.id, form);
      load();
      setModal(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(o: Organization) {
    if (!confirm(`Удалить организацию "${o.name}"? Это удалит всех пользователей и группы!`)) return;
    await orgsApi.delete(o.id).catch(console.error);
    load();
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-white text-base tracking-wider">ОРГАНИЗАЦИИ</h2>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest">
          <Plus className="w-3 h-3" /> СОЗДАТЬ
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {orgs.map((o) => (
          <div key={o.id} className="card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-ptt-green shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-rajdhani font-bold text-white">{o.name}</p>
                <p className="font-mono text-ptt-muted text-xs">{o.slug}</p>
              </div>
            </div>
            <div className="flex gap-4 font-mono text-xs text-ptt-muted border-t border-ptt-border/50 pt-2">
              <span>{o._count?.users ?? 0} польз.</span>
              <span>{o._count?.groups ?? 0} групп</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => openEdit(o)} className="text-ptt-muted hover:text-white">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(o)} className="text-ptt-muted hover:text-ptt-danger">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="font-orbitron text-white text-sm">
                {modal === 'create' ? 'НОВАЯ ОРГАНИЗАЦИЯ' : 'РЕДАКТИРОВАТЬ'}
              </p>
              <button onClick={() => setModal(null)} className="text-ptt-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="font-mono text-ptt-muted text-xs block mb-1">НАЗВАНИЕ</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="font-mono text-ptt-muted text-xs block mb-1">SLUG (только a-z, 0-9, -)</label>
                <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} className={inputCls} />
              </div>
              <div>
                <label className="font-mono text-ptt-muted text-xs block mb-1">ОПИСАНИЕ</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
              </div>
              {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
              <button onClick={handleSave} disabled={loading}
                className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50">
                {loading ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
