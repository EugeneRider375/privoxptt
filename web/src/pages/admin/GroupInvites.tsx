import { useEffect, useState } from 'react';
import {
  AlertTriangle, Ban, History, KeyRound, Link2, Loader2, QrCode as QrIcon, RefreshCw, Send, X,
} from 'lucide-react';
import clsx from 'clsx';

import { onboardingApi } from '@/api/client';
import { QrCode, downloadQr } from '@/components/ui/QrCode';
import { openInviteSheet } from '@/utils/invitePrint';
import type { CreatedMember, Group, GroupInvite, GroupInvitesResponse, InviteStatus } from '@/types';

/**
 * Приглашения группы: кто активировался, кто ещё нет, у кого истекло.
 *
 * Показать выданную ранее ссылку невозможно — в базе от токена остаётся только
 * sha256. Поэтому вместо «посмотреть» здесь «выпустить заново»: новая ссылка
 * появляется один раз, старая в тот же момент перестаёт работать.
 */

const STATUS_STYLE: Record<InviteStatus, { label: string; cls: string; hint: string }> = {
  CREATED:   { label: 'sent',      cls: 'text-ptt-muted',  hint: 'Issued, the link has not been opened yet' },
  OPENED:    { label: 'opened',    cls: 'text-ptt-blue',   hint: 'The link was opened but not confirmed' },
  ACTIVATED: { label: 'activated', cls: 'text-ptt-green',  hint: 'The member is in the group' },
  EXPIRED:   { label: 'expired',   cls: 'text-ptt-warn',   hint: 'Valid period is over — reissue to restore access' },
  REVOKED:   { label: 'revoked',   cls: 'text-ptt-danger', hint: 'Cancelled by an administrator' },
};

interface FreshLink {
  inviteId: string;
  callsign: string;
  url: string;
  expiresAt: string;
}

interface Secret {
  callsign: string;
  login: string | null;
  password: string;
}

export function GroupInvites({ group, onClose }: { group: Group; onClose: () => void }) {
  const [data, setData] = useState<GroupInvitesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState<FreshLink | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [copied, setCopied] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  /** Пачка свежих ссылок после «выдать всем» — видна один раз. */
  const [batch, setBatch] = useState<CreatedMember[] | null>(null);

  function load() {
    onboardingApi
      .invitesOfGroup(group.id)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.error ?? 'Could not load invitations'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [group.id]);

  async function handleReissue(invite: GroupInvite) {
    setBusy(invite.id);
    setError('');
    try {
      const r = await onboardingApi.reissueInvite(invite.id, { expiresInDays: 14, singleUse: false });
      setFresh({
        inviteId: r.id,
        callsign: invite.user.callsign,
        url: r.inviteUrl,
        expiresAt: r.expiresAt,
      });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Reissue failed');
    } finally {
      setBusy('');
    }
  }

  async function handleRevoke(invite: GroupInvite) {
    if (!confirm(`Revoke the invitation for ${invite.user.callsign}? The link stops working immediately.`)) return;
    setBusy(invite.id);
    setError('');
    try {
      await onboardingApi.revokeInvite(invite.id);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Revoke failed');
    } finally {
      setBusy('');
    }
  }

  /** Выдать приглашение тому, кто в группе, но без него — типично для старых групп. */
  async function handleIssueOne(user: GroupInvite['user']) {
    setBusy(user.id);
    setError('');
    try {
      const r = await onboardingApi.inviteMember(group.id, user.id, { expiresInDays: 14, singleUse: false });
      setFresh({ inviteId: r.id, callsign: user.callsign, url: r.inviteUrl, expiresAt: r.expiresAt });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not issue an invitation');
    } finally {
      setBusy('');
    }
  }

  /** Разом всем без приглашения. Ссылки показываются один раз. */
  async function handleIssueAll() {
    setBusy('all');
    setError('');
    try {
      const r = await onboardingApi.inviteMissing(group.id, { expiresInDays: 14, singleUse: false });
      setBatch(r.members);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not issue invitations');
    } finally {
      setBusy('');
    }
  }

  async function handleNewPassword(invite: GroupInvite) {
    setBusy(invite.id);
    setError('');
    try {
      const r = await onboardingApi.newPassword(invite.user.id);
      setSecret({ callsign: r.callsign, login: r.login, password: r.tempPassword });
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not issue a password');
    } finally {
      setBusy('');
    }
  }

  /**
   * Каждый перевыпуск гасит предыдущее приглашение, и мёртвые строки копятся:
   * у одного человека их может стать десяток. Показываем только текущее —
   * самое свежее для каждого участника, — а прежние прячем за переключателем.
   * Сервер отдаёт список уже отсортированным от новых к старым.
   */
  function splitCurrentAndHistory(invites: GroupInvite[]) {
    const seen = new Set<string>();
    const current: GroupInvite[] = [];
    const history: GroupInvite[] = [];
    for (const i of invites) {
      if (seen.has(i.user.id)) history.push(i);
      else {
        seen.add(i.user.id);
        current.push(i);
      }
    }
    return { current, history };
  }

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(''), 1500);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 p-4 overflow-y-auto">
      <div className="card w-full max-w-3xl p-5 my-4">
        <div className="flex items-center justify-between mb-4">
          <p className="font-orbitron text-white text-sm tracking-widest">
            INVITATIONS · {group.name.toUpperCase()}
          </p>
          <button onClick={onClose} className="text-ptt-muted hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-8 justify-center">
            <Loader2 className="w-5 h-5 text-ptt-green animate-spin" />
            <span className="font-mono text-ptt-muted text-xs">Loading…</span>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 font-mono text-ptt-danger text-xs mb-3">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        )}

        {/* Свежая ссылка — видна ровно сейчас и больше никогда. */}
        {fresh && (
          <div className="rounded border border-ptt-green/40 bg-ptt-green/5 p-3 mb-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-orbitron text-ptt-green text-xs tracking-widest">
                  NEW LINK FOR {fresh.callsign}
                </p>
                <p className="font-mono text-ptt-muted text-[11px] mt-1">
                  Shown once. The previous link stopped working. Valid until{' '}
                  {new Date(fresh.expiresAt).toLocaleDateString()}.
                </p>
              </div>
              <button onClick={() => setFresh(null)} className="text-ptt-muted hover:text-white shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <QrCode value={fresh.url} size={96} alt={`QR for ${fresh.callsign}`} />
              <div className="min-w-0 space-y-2">
                <p className="font-mono text-ptt-muted text-[10px] break-all">{fresh.url}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => copy(fresh.url, 'fresh')}
                    className="flex items-center gap-1 border border-ptt-border text-ptt-text font-mono text-[11px] px-2 py-1 rounded hover:text-white">
                    <Link2 className="w-3 h-3" /> {copied === 'fresh' ? 'copied' : 'copy link'}
                  </button>
                  <button onClick={() => downloadQr(fresh.url, `${fresh.callsign}-invite`)}
                    className="flex items-center gap-1 border border-ptt-border text-ptt-text font-mono text-[11px] px-2 py-1 rounded hover:text-white">
                    save png
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Пачка ссылок после «выдать всем» — видна один раз, как и всё остальное. */}
        {batch && (
          <div className="rounded border border-ptt-green/40 bg-ptt-green/5 p-3 mb-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-orbitron text-ptt-green text-xs tracking-widest">
                  {batch.length} INVITATIONS ISSUED — SAVE THEM NOW
                </p>
                <p className="font-mono text-ptt-muted text-[11px] mt-1">
                  Shown once. Print the sheet or copy the links before closing this panel.
                </p>
              </div>
              <button onClick={() => setBatch(null)} className="text-ptt-muted hover:text-white shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() =>
                openInviteSheet(
                  group.name,
                  group.organization?.name ?? '',
                  batch,
                  new Date(Date.now() + 14 * 86_400_000).toISOString()
                )
              }
              className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest"
            >
              PRINT ALL QR
            </button>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {batch.map((m) => (
                <div key={m.userId} className="flex items-center gap-2 rounded border border-ptt-border bg-ptt-dark p-2">
                  <QrCode value={m.inviteUrl} size={48} alt={`QR for ${m.callsign}`} />
                  <div className="min-w-0">
                    <p className="callsign text-xs truncate">{m.callsign}</p>
                    <button onClick={() => copy(m.inviteUrl, m.userId)}
                      className="font-mono text-[10px] text-ptt-blue hover:text-white">
                      {copied === m.userId ? 'copied' : 'copy link'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Новый пароль — тоже единожды. */}
        {secret && (
          <div className="rounded border border-ptt-warn/40 bg-ptt-warn/5 p-3 mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-orbitron text-ptt-warn text-xs tracking-widest">
                  NEW PASSWORD FOR {secret.callsign}
                </p>
                <p className="font-mono text-white text-sm mt-2">
                  {secret.login} / {secret.password}
                </p>
                <p className="font-mono text-ptt-muted text-[11px] mt-1">
                  Shown once. All existing sessions of this member were signed out.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => copy(`${secret.login} / ${secret.password}`, 'pw')}
                  className="font-mono text-[11px] text-ptt-blue hover:text-white">
                  {copied === 'pw' ? 'copied' : 'copy'}
                </button>
                <button onClick={() => setSecret(null)} className="text-ptt-muted hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {data && (() => {
          const { current, history } = splitCurrentAndHistory(data.invites);
          const visible = showHistory ? [...current, ...history] : current;
          return (
          <>
            <div className="border border-ptt-border rounded overflow-hidden">
              <div className="max-h-[26rem] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="bg-ptt-dark sticky top-0">
                    <tr className="font-mono text-ptt-muted text-[10px] tracking-widest">
                      <th className="px-3 py-2">CALLSIGN</th>
                      <th className="px-3 py-2">LOGIN</th>
                      <th className="px-3 py-2">STATUS</th>
                      <th className="px-3 py-2">VALID UNTIL</th>
                      <th className="px-3 py-2">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((i) => {
                      const st = STATUS_STYLE[i.status];
                      const working = busy === i.id;
                      return (
                        <tr key={i.id} className="border-t border-ptt-border/40">
                          <td className="px-3 py-2 callsign text-xs">
                            {i.user.callsign}
                            {!i.user.isActive && (
                              <span className="ml-2 font-mono text-[10px] text-ptt-danger">disabled</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ptt-text">{i.user.login ?? '—'}</td>
                          <td className="px-3 py-2">
                            <span className={clsx('font-mono text-[11px]', st.cls)} title={st.hint}>
                              {st.label}
                            </span>
                            {i.singleUse && (
                              <span className="ml-2 font-mono text-[10px] text-ptt-muted">single use</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-ptt-muted">
                            {new Date(i.expiresAt).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <button onClick={() => handleReissue(i)} disabled={working}
                                title="Issue a new link — the old one stops working"
                                className="flex items-center gap-1 font-mono text-[11px] text-ptt-green hover:text-white disabled:opacity-40">
                                {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                reissue
                              </button>
                              {i.status !== 'REVOKED' && (
                                <button onClick={() => handleRevoke(i)} disabled={working}
                                  title="Cancel this invitation"
                                  className="flex items-center gap-1 font-mono text-[11px] text-ptt-muted hover:text-ptt-danger disabled:opacity-40">
                                  <Ban className="w-3 h-3" /> revoke
                                </button>
                              )}
                              <button onClick={() => handleNewPassword(i)} disabled={working}
                                title="Issue a new temporary password"
                                className="flex items-center gap-1 font-mono text-[11px] text-ptt-muted hover:text-white disabled:opacity-40">
                                <KeyRound className="w-3 h-3" /> password
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {data.invites.length === 0 && (
              <p className="font-mono text-ptt-muted text-xs text-center py-6">
                No invitations in this group yet — use Add to issue them.
              </p>
            )}

            {history.length > 0 && (
              <button onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 font-mono text-[11px] text-ptt-muted hover:text-white mt-3">
                <History className="w-3 h-3" />
                {showHistory
                  ? 'hide superseded invitations'
                  : `show ${history.length} superseded ${history.length === 1 ? 'invitation' : 'invitations'}`}
              </button>
            )}

            {data.membersWithoutInvite.length > 0 && (
              <div className="rounded border border-ptt-warn/40 bg-ptt-warn/5 p-3 mt-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-mono text-ptt-warn text-xs tracking-widest">
                      {data.membersWithoutInvite.length} WITHOUT AN INVITATION
                    </p>
                    <p className="font-mono text-ptt-muted text-[11px] mt-1">
                      They joined before invitations existed, or were added by hand. They can sign in with a
                      login and password, but have no QR code.
                    </p>
                  </div>
                  <button onClick={handleIssueAll} disabled={busy === 'all'}
                    className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest disabled:opacity-50 shrink-0">
                    {busy === 'all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    ISSUE FOR ALL
                  </button>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  {data.membersWithoutInvite.map((u) => (
                    <button key={u.id} onClick={() => handleIssueOne(u)} disabled={busy === u.id}
                      title={`Issue an invitation for ${u.callsign}`}
                      className="flex items-center gap-1 font-mono text-[11px] text-ptt-text hover:text-white disabled:opacity-40">
                      {busy === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <QrIcon className="w-3 h-3" />}
                      {u.callsign}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="font-mono text-ptt-muted text-[11px] mt-3">
              A link cannot be shown twice — only the hash of it is stored. Lost one? Use{' '}
              <span className="text-ptt-green">reissue</span>: a new link appears once and the old one dies
              immediately.
            </p>
          </>
          );
        })()}
      </div>
    </div>
  );
}
