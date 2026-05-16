import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RotateCcw, Search, X, Check, MicOff } from 'lucide-react';
import { usersApi, groupsApi } from '@/api/client';
import { useStore } from '@/store/useStore';
import type { User, Group, UserRole } from '@/types';
import clsx from 'clsx';

const ROLES: UserRole[] = ['USER', 'DISPATCHER', 'ADMIN', 'SUPERADMIN'];
const ROLE_COLOR: Record<UserRole, string> = {
  USER:       'text-ptt-text',
  DISPATCHER: 'text-ptt-blue',
  ADMIN:      'text-ptt-warn',
  SUPERADMIN: 'text-ptt-danger',
};

interface UserFormData {
  email: string;
  password: string;
  callsign: string;
  displayName: string;
  role: UserRole;
}

const EMPTY_FORM: UserFormData = {
  email: '', password: '', callsign: '', displayName: '', role: 'USER',
};

export function AdminUsers() {
  const currentUser = useStore((s) => s.user);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'create' | 'edit' | 'reset' | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    usersApi.list().then(setUsers).catch(console.error);
    groupsApi.list().then(setGroups).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const filtered = users.filter((u) =>
    u.callsign.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.displayName.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setForm(EMPTY_FORM);
    setError('');
    setModal('create');
  }

  function openEdit(u: User) {
    setSelected(u);
    setForm({ email: u.email, password: '', callsign: u.callsign, displayName: u.displayName, role: u.role });
    setError('');
    setModal('edit');
  }

  function openReset(u: User) {
    setSelected(u);
    setNewPass('');
    setError('');
    setModal('reset');
  }

  async function handleCreate() {
    setLoading(true);
    setError('');
    try {
      await usersApi.create(form);
      load();
      setModal(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  async function handleEdit() {
    if (!selected) return;
    setLoading(true);
    setError('');
    try {
      await usersApi.update(selected.id, {
        callsign: form.callsign,
        displayName: form.displayName,
        role: form.role,
      });
      load();
      setModal(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!selected || !newPass) return;
    setLoading(true);
    try {
      await usersApi.resetPassword(selected.id, newPass);
      setModal(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(u: User) {
    if (!confirm(`Удалить ${u.callsign}?`)) return;
    await usersApi.delete(u.id).catch(console.error);
    load();
  }

  return (
    <div className="p-4 space-y-4">
      {/* Шапка */}
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-white text-base tracking-wider">ПОЛЬЗОВАТЕЛИ</h2>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest hover:bg-ptt-green/90 transition-colors"
        >
          <Plus className="w-3 h-3" /> ДОБАВИТЬ
        </button>
      </div>

      {/* Поиск */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ptt-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по позывному, email..."
          className="w-full bg-ptt-card border border-ptt-border rounded pl-9 pr-4 py-2 font-mono text-sm text-white placeholder-ptt-muted focus:outline-none focus:border-ptt-green"
        />
      </div>

      {/* Таблица */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ptt-border">
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">ПОЗЫВНОЙ</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">ИМЯ</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">EMAIL</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">РОЛЬ</th>
                <th className="text-left font-mono text-ptt-muted text-xs px-3 py-2 tracking-widest">СТАТУС</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-ptt-border/30 hover:bg-ptt-muted/5">
                  <td className="px-3 py-2.5">
                    <span className="callsign text-sm">{u.callsign}</span>
                  </td>
                  <td className="px-3 py-2.5 font-rajdhani text-white">{u.displayName}</td>
                  <td className="px-3 py-2.5 font-mono text-ptt-text text-xs">{u.email}</td>
                  <td className={clsx('px-3 py-2.5 font-mono text-xs', ROLE_COLOR[u.role])}>{u.role}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className={(u.isOnline ?? false) ? 'online-dot' : 'offline-dot'} />
                      <span className="font-mono text-xs text-ptt-muted">
                        {(u.isOnline ?? false) ? 'онлайн' : 'офлайн'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(u)} className="text-ptt-muted hover:text-white transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => openReset(u)} className="text-ptt-muted hover:text-ptt-warn transition-colors">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(u)} className="text-ptt-muted hover:text-ptt-danger transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center font-mono text-ptt-muted text-xs py-8">НЕТ ПОЛЬЗОВАТЕЛЕЙ</p>
        )}
      </div>

      {/* Модалки */}
      {(modal === 'create' || modal === 'edit') && (
        <Modal title={modal === 'create' ? 'НОВЫЙ ПОЛЬЗОВАТЕЛЬ' : 'РЕДАКТИРОВАТЬ'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            {modal === 'create' && (
              <Field label="EMAIL">
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputCls} required />
              </Field>
            )}
            {modal === 'create' && (
              <Field label="ПАРОЛЬ">
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputCls} minLength={8} required />
              </Field>
            )}
            <Field label="ПОЗЫВНОЙ">
              <input value={form.callsign} onChange={(e) => setForm({ ...form, callsign: e.target.value })}
                className={inputCls} placeholder="ALPHA-1" required />
            </Field>
            <Field label="ИМЯ">
              <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className={inputCls} required />
            </Field>
            <Field label="РОЛЬ">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                className={inputCls}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
            <button
              onClick={modal === 'create' ? handleCreate : handleEdit}
              disabled={loading}
              className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50"
            >
              {loading ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ'}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'reset' && (
        <Modal title="СБРОС ПАРОЛЯ" onClose={() => setModal(null)}>
          <p className="callsign text-sm mb-3">{selected?.callsign}</p>
          <Field label="НОВЫЙ ПАРОЛЬ">
            <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)}
              className={inputCls} minLength={8} />
          </Field>
          {error && <p className="font-mono text-ptt-danger text-xs mt-2">{error}</p>}
          <button
            onClick={handleReset}
            disabled={loading || !newPass}
            className="w-full mt-3 bg-ptt-warn text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50"
          >
            СБРОСИТЬ ПАРОЛЬ
          </button>
        </Modal>
      )}
    </div>
  );
}

// ─── Вспомогательные компоненты ───────────────────────────
const inputCls = 'w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';

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
      <div className="card w-full max-w-sm p-4 relative">
        <div className="flex items-center justify-between mb-4">
          <p className="font-orbitron text-white text-sm tracking-widest">{title}</p>
          <button onClick={onClose} className="text-ptt-muted hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
