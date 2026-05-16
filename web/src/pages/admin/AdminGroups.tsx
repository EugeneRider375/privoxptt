import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users, X, UserPlus, UserMinus, MicOff, Mic } from 'lucide-react';
import { groupsApi, usersApi } from '@/api/client';
import type { Group, User, GroupMember } from '@/types';

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

const COLORS = ['#3DDC84', '#4A9EFF', '#FFB800', '#FF4444', '#B44AFF', '#FF6B35'];

export function AdminGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [modal, setModal] = useState<'create' | 'edit' | 'members' | null>(null);
  const [selected, setSelected] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [form, setForm] = useState({ name: '', description: '', color: '#3DDC84', priority: 0, isPrivate: false });
  const [addUserId, setAddUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    groupsApi.list().then(setGroups).catch(console.error);
    usersApi.list().then(setAllUsers).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  async function loadMembers(groupId: string) {
    const g = await groupsApi.get(groupId);
    setMembers(g.members ?? []);
  }

  function openCreate() {
    setForm({ name: '', description: '', color: '#3DDC84', priority: 0, isPrivate: false });
    setError('');
    setModal('create');
  }

  function openEdit(g: Group) {
    setSelected(g);
    setForm({ name: g.name, description: g.description ?? '', color: g.color, priority: g.priority, isPrivate: g.isPrivate });
    setError('');
    setModal('edit');
  }

  async function openMembers(g: Group) {
    setSelected(g);
    await loadMembers(g.id);
    setModal('members');
  }

  async function handleSave() {
    setLoading(true);
    setError('');
    try {
      if (modal === 'create') await groupsApi.create(form);
      else if (modal === 'edit' && selected) await groupsApi.update(selected.id, form);
      load();
      setModal(null);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(g: Group) {
    if (!confirm(`Delete group "${g.name}"?`)) return;
    await groupsApi.delete(g.id).catch(console.error);
    load();
  }

  async function handleAddMember() {
    if (!selected || !addUserId) return;
    await groupsApi.addMember(selected.id, addUserId);
    await loadMembers(selected.id);
    setAddUserId('');
  }

  async function handleRemoveMember(userId: string) {
    if (!selected) return;
    await groupsApi.removeMember(selected.id, userId);
    await loadMembers(selected.id);
  }

  async function handleToggleSpeak(member: GroupMember) {
    if (!selected) return;
    await groupsApi.updateMember(selected.id, member.userId, !member.canSpeak);
    await loadMembers(selected.id);
  }

  const nonMembers = allUsers.filter((u) => !members.some((m) => m.userId === u.id));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-orbitron text-white text-base tracking-wider">GROUPS / CHANNELS</h2>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest hover:bg-ptt-green/90">
          <Plus className="w-3 h-3" /> CREATE
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.id} className="card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: g.color }} />
              <div className="flex-1 min-w-0">
                <p className="font-rajdhani font-bold text-white truncate">{g.name}</p>
                {g.description && <p className="font-mono text-ptt-muted text-xs truncate">{g.description}</p>}
              </div>
            </div>

            <div className="flex items-center gap-4 font-mono text-xs text-ptt-muted">
              <span>{g._count?.members ?? 0} members</span>
              <span>P:{g.priority}</span>
              {g.isPrivate && <span className="text-ptt-warn">PRIVATE</span>}
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-ptt-border/50">
              <button onClick={() => openMembers(g)} className="flex items-center gap-1 text-ptt-blue hover:text-white transition-colors font-mono text-xs">
                <Users className="w-3 h-3" /> Members
              </button>
              <button onClick={() => openEdit(g)} className="ml-auto text-ptt-muted hover:text-white transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(g)} className="text-ptt-muted hover:text-ptt-danger transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Создать/Редактировать */}
      {(modal === 'create' || modal === 'edit') && (
        <Modal title={modal === 'create' ? 'NEW GROUP' : 'EDIT'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <Field label="NAME">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="DESCRIPTION">
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
            </Field>
            <Field label="PRIORITY (0-100)">
              <input type="number" min={0} max={100} value={form.priority}
                onChange={(e) => setForm({ ...form, priority: +e.target.value })} className={inputCls} />
            </Field>
            <Field label="COLOR">
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded border-2 transition-transform ${form.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isPrivate}
                onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })}
                className="accent-ptt-green" />
              <span className="font-mono text-xs text-ptt-text">Private group</span>
            </label>
            {error && <p className="font-mono text-ptt-danger text-xs">{error}</p>}
            <button onClick={handleSave} disabled={loading}
              className="w-full bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest disabled:opacity-50">
              {loading ? 'SAVING...' : 'SAVE'}
            </button>
          </div>
        </Modal>
      )}

      {/* Участники */}
      {modal === 'members' && selected && (
        <Modal title={`MEMBERS · ${selected.name}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            {/* Добавить участника */}
            <div className="flex gap-2">
              <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className={`${inputCls} flex-1`}>
                <option value="">- select user -</option>
                {nonMembers.map((u) => (
                  <option key={u.id} value={u.id}>{u.callsign} — {u.displayName}</option>
                ))}
              </select>
              <button onClick={handleAddMember} disabled={!addUserId}
                className="px-3 py-2 bg-ptt-green text-ptt-dark rounded disabled:opacity-50">
                <UserPlus className="w-4 h-4" />
              </button>
            </div>

            {/* Список участников */}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 p-2 rounded bg-ptt-dark border border-ptt-border/40">
                  <span className="callsign text-xs flex-1">{m.user.callsign}</span>
                  <span className="font-rajdhani text-xs text-ptt-muted flex-1">{m.user.displayName}</span>
                  <button onClick={() => handleToggleSpeak(m)}
                    className={`${m.canSpeak ? 'text-ptt-green' : 'text-ptt-muted'} hover:text-white transition-colors`}
                    title={m.canSpeak ? 'Disable speaking' : 'Allow speaking'}>
                    {m.canSpeak ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => handleRemoveMember(m.userId)}
                    className="text-ptt-muted hover:text-ptt-danger transition-colors">
                    <UserMinus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {members.length === 0 && (
                <p className="font-mono text-ptt-muted text-xs text-center py-4">NO MEMBERS</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
