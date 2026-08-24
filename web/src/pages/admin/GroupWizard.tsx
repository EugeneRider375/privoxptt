import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, Download, Eye, EyeOff,
  FileDown, ImageIcon, KeyRound, Link2, Printer, QrCode as QrIcon, Send, ShieldAlert, UserPlus, Users, X,
} from 'lucide-react';
import clsx from 'clsx';

import { onboardingApi } from '@/api/client';
import { QrCode, downloadQr } from '@/components/ui/QrCode';
import { buildInviteMessage, openInviteSheet, shareInvite } from '@/utils/invitePrint';
import { saveInvitePdf } from '@/utils/invitePdf';
import { canCopyImage, copyInviteCard, downloadBlob, renderInviteCard, shareInviteCard } from '@/utils/inviteCard';
import type {
  CreatedMember, Organization, PreviewRow, UserRole, WizardPreview, WizardResult,
} from '@/types';

/**
 * Пошаговое создание группы: параметры → участники → роли → учётные данные →
 * предварительный просмотр → результат.
 *
 * Ничего не создаётся до шага 6. Шаг 5 запрашивает у сервера предпросмотр —
 * запрос только читает базу.
 */

const inputCls =
  'w-full bg-ptt-dark border border-ptt-border rounded px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ptt-green';

const COLORS = ['#3DDC84', '#4A9EFF', '#FFB800', '#FF4444', '#B44AFF', '#FF6B35'];

const STEPS = ['Group', 'Members', 'Roles', 'Credentials', 'Preview', 'Done'] as const;

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: 'USER', label: 'Member', hint: 'Regular radio user' },
  { value: 'DISPATCHER', label: 'Dispatcher', hint: 'Sees everything, talks to any group' },
  { value: 'ADMIN', label: 'Group admin', hint: 'Administrator of the organization' },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="font-mono text-ptt-muted text-xs tracking-widest block mb-1">{label}</label>
      {children}
      {hint && <p className="font-mono text-ptt-muted text-[11px] mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked, onChange, label, hint, danger,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; danger?: boolean }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={clsx('mt-0.5', danger ? 'accent-ptt-danger' : 'accent-ptt-green')}
      />
      <span>
        <span className="font-mono text-xs text-ptt-text">{label}</span>
        {hint && <span className="block font-mono text-ptt-muted text-[11px]">{hint}</span>}
      </span>
    </label>
  );
}

/** Дата из <input type="date"> → ISO. Пусто → null («без ограничения»). */
function toIso(value: string, endOfDay = false): string | null {
  if (!value) return null;
  return new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString();
}

interface Props {
  organizations: Organization[];
  /** Организация, выбранная на странице групп. */
  defaultOrgId: string;
  isSuperAdmin: boolean;
  onClose: () => void;
  /** Вызывается после успешного создания, чтобы список групп обновился. */
  onCreated: () => void;
  /**
   * Задана — вопросник работает в режиме пополнения: шаг с параметрами группы
   * пропускается, участники добавляются в неё. Не задана — создаём новую.
   */
  existingGroup?: { id: string; name: string };
}

export function GroupWizard({
  organizations, defaultOrgId, isSuperAdmin, onClose, onCreated, existingGroup,
}: Props) {
  // В режиме пополнения первый шаг не нужен: группа уже выбрана.
  const firstStep = existingGroup ? 1 : 0;
  const [step, setStep] = useState(firstStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Шаг 1 — параметры группы
  const [organizationId, setOrganizationId] = useState(defaultOrgId || organizations[0]?.id || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [unlimited, setUnlimited] = useState(true);
  const [endDate, setEndDate] = useState('');
  const [activateNow, setActivateNow] = useState(true);
  const [priority, setPriority] = useState(0);
  const [color, setColor] = useState('#3DDC84');
  const [isPrivate, setIsPrivate] = useState(false);

  // Шаг 2 — участники
  const [membersText, setMembersText] = useState('');

  // Шаг 3 — роли и права по умолчанию
  const [role, setRole] = useState<UserRole>('USER');
  const [canSpeak, setCanSpeak] = useState(true);
  const [canMessage, setCanMessage] = useState(true);
  const [canShareLocation, setCanShareLocation] = useState(true);

  // Шаг 4 — учётные данные
  const [passwordMode, setPasswordMode] = useState<'individual' | 'shared'>('individual');
  const [sharedPassword, setSharedPassword] = useState('');
  const [acknowledgeSharedRisk, setAcknowledgeSharedRisk] = useState(false);
  const [inviteDays, setInviteDays] = useState(14);
  const [singleUse, setSingleUse] = useState(true);

  // Шаг 5 — предпросмотр
  const [preview, setPreview] = useState<WizardPreview | null>(null);
  const [actions, setActions] = useState<Record<string, PreviewRow['defaultAction']>>({});

  // Шаг 6 — результат
  const [result, setResult] = useState<WizardResult | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [copied, setCopied] = useState('');
  const [zoomedQr, setZoomedQr] = useState<CreatedMember | null>(null);
  const [cardBusy, setCardBusy] = useState('');
  /**
   * Карточки рисуются ЗАРАНЕЕ, как только показан результат.
   *
   * Иначе не работает главное: и «Поделиться», и запись в буфер разрешены
   * браузером только синхронно, в момент нажатия. Любое ожидание внутри
   * обработчика — отрисовка canvas, генерация QR — делает жест устаревшим,
   * и телефон отправляет сообщение без картинки. Готовим всё заранее, тогда
   * обработчик остаётся мгновенным.
   */
  const [cards, setCards] = useState<Record<string, Blob>>({});
  const [cardsReady, setCardsReady] = useState(false);
  // Что именно произошло с карточкой — иначе непонятно, копировать или искать файл.
  const [cardState, setCardState] = useState<{ tag: string; state: 'copied' | 'saved' } | null>(null);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setCardsReady(false);

    (async () => {
      for (const m of result.members) {
        if (cancelled) return;
        try {
          const blob = await renderInviteCard(
            m, result.group.name, result.organization.name, result.invites.expiresAt
          );
          if (cancelled) return;
          setCards((prev) => ({ ...prev, [m.userId]: blob }));
        } catch {
          // Одна не нарисовалась — остальные не роняем, кнопка уйдёт в запасной путь.
        }
      }
      if (!cancelled) setCardsReady(true);
    })();

    return () => { cancelled = true; };
  }, [result]);

  // Счётчик участников считается сам — вручную его вводить не нужно.
  const parsedCount = useMemo(
    () => membersText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length,
    [membersText]
  );

  const groupPayload = () => ({
    name: name.trim(),
    description: description.trim() || undefined,
    startsAt: toIso(startDate),
    endsAt: unlimited ? null : toIso(endDate, true),
    activateNow,
    priority,
    color,
    isPrivate,
  });

  const canLeaveStep1 = name.trim().length >= 2 && (!isSuperAdmin || !!organizationId) && (unlimited || !!endDate);
  const canLeaveStep2 = parsedCount > 0;
  const canLeaveStep4 =
    passwordMode === 'individual' || (sharedPassword.length >= 8 && acknowledgeSharedRisk);

  async function loadPreview() {
    setLoading(true);
    setError('');
    try {
      const data: WizardPreview = existingGroup
        ? await onboardingApi.previewForGroup(existingGroup.id, { membersText })
        : await onboardingApi.preview({
            organizationId: isSuperAdmin ? organizationId : undefined,
            group: groupPayload(),
            membersText,
          });
      setPreview(data);
      setActions(Object.fromEntries(data.rows.map((r) => [r.callsign, r.defaultAction])));
      setStep(4);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!preview) return;
    setLoading(true);
    setError('');
    try {
      const members = preview.rows
        .filter((r) => r.status !== 'REJECTED')
        .map((r) => ({
          callsign: r.callsign,
          action: actions[r.callsign] ?? r.defaultAction,
          userId: r.existing?.userId,
          login: r.login,
          role,
          canSpeak,
          canMessage,
          canShareLocation,
          isGroupAdmin: false,
        }))
        .filter((m) => m.action !== 'skip');

      const payload = {
        members,
        invites: { expiresInDays: inviteDays, singleUse },
        password: {
          mode: passwordMode,
          sharedPassword: passwordMode === 'shared' ? sharedPassword : undefined,
          acknowledgeSharedRisk,
        },
      };

      const data: WizardResult = existingGroup
        ? await onboardingApi.addToGroup(existingGroup.id, payload)
        : await onboardingApi.create({
            organizationId: isSuperAdmin ? organizationId : undefined,
            group: groupPayload(),
            ...payload,
          });
      setResult(data);
      setStep(5);
      onCreated();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Creation failed');
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(''), 1500);
    });
  }

  /**
   * Отдать приглашение одним действием: где браузер умеет системное
   * «Поделиться» — открываем его, иначе кладём готовый текст в буфер.
   */
  async function shareOrCopy(m: CreatedMember, tag: string) {
    if (!result) return;
    const text = buildInviteMessage(m, result.group.name, result.invites.expiresAt);
    const shared = await shareInvite(text, `PRIVOX — ${m.callsign}`);
    if (!shared) copy(text, tag);
  }

  /**
   * Карточка приглашения картинкой. Обработчик СИНХРОННЫЙ: и «Поделиться»,
   * и запись в буфер требуют неостывшего пользовательского жеста, поэтому
   * готовая картинка берётся из заранее отрисованных.
   */
  function shareCard(m: CreatedMember, tag: string) {
    if (!result) return;
    const filename = `${m.callsign.replace(/[^\w-]+/g, '_')}-privox-invite.png`;
    const text = buildInviteMessage(m, result.group.name, result.invites.expiresAt);
    const blob = cards[m.userId];

    const done = (state: 'copied' | 'saved') => {
      setCardState({ tag, state });
      setTimeout(() => setCardState(null), 2500);
    };

    if (!blob) {
      // Ещё не готова — рисуем и просто отдаём файлом, без буфера и «Поделиться»:
      // жест к этому моменту всё равно истечёт.
      setCardBusy(tag);
      renderInviteCard(m, result.group.name, result.organization.name, result.invites.expiresAt)
        .then((b) => { downloadBlob(b, filename); done('saved'); })
        .catch(() => setError('Could not build the invitation card'))
        .finally(() => setCardBusy(''));
      return;
    }

    const file = new File([blob], filename, { type: 'image/png' });

    // Телефон: одно действие отправляет и картинку, и текст.
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ title: `PRIVOX — ${m.callsign}`, text, files: [file] }).catch((err) => {
        if ((err as Error)?.name === 'AbortError') return;
        downloadBlob(blob, filename);
        done('saved');
      });
      return;
    }

    // Компьютер: в буфер, чтобы вставить прямо в окно мессенджера.
    copyInviteCard(Promise.resolve(blob)).then((ok) => {
      if (ok) return done('copied');
      downloadBlob(blob, filename);
      done('saved');
    });
  }

  function credentialsCsv(members: CreatedMember[]): string {
    const head = 'callsign,login,temporary_password,invite_url';
    const rows = members.map((m) =>
      [m.callsign, m.login ?? '', m.tempPassword ?? '', m.inviteUrl]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    return [head, ...rows].join('\n');
  }

  function downloadCsv() {
    if (!result) return;
    const blob = new Blob([credentialsCsv(result.members)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.group.name.replace(/[^\w-]+/g, '_')}-credentials.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeCount = preview
    ? preview.rows.filter((r) => r.status !== 'REJECTED' && (actions[r.callsign] ?? r.defaultAction) !== 'skip').length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 p-4 overflow-y-auto">
      <div className="card w-full max-w-3xl p-5 my-4">
        {/* Заголовок и шаги */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-orbitron text-white text-sm tracking-widest">
            {existingGroup ? `ADD MEMBERS — ${existingGroup.name.toUpperCase()}` : 'NEW GROUP — GUIDED SETUP'}
          </p>
          <button onClick={onClose} className="text-ptt-muted hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex items-center gap-1 mb-5 overflow-x-auto">
          {STEPS.map((s, i) => (i < firstStep ? null : (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <div className={clsx(
                'flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px] tracking-wider',
                i === step ? 'bg-ptt-green/20 text-ptt-green'
                  : i < step ? 'text-ptt-green/70' : 'text-ptt-muted'
              )}>
                <span className={clsx(
                  'w-4 h-4 rounded-full flex items-center justify-center text-[10px]',
                  i < step ? 'bg-ptt-green text-ptt-dark' : i === step ? 'border border-ptt-green' : 'border border-ptt-muted'
                )}>
                  {i < step ? <Check className="w-2.5 h-2.5" /> : i + 1}
                </span>
                {s.toUpperCase()}
              </div>
              {i < STEPS.length - 1 && <span className="text-ptt-border">·</span>}
            </div>
          )))}
        </div>

        {/* ── Шаг 1: параметры группы ───────────────────────── */}
        {step === 0 && (
          <div className="space-y-3">
            {isSuperAdmin && (
              <Field label="ORGANIZATION">
                <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className={inputCls}>
                  <option value="">- select organization -</option>
                  {organizations.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.slug}</option>)}
                </select>
              </Field>
            )}
            <Field label="GROUP NAME">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Brigade Alpha" />
            </Field>
            <Field label="DESCRIPTION" hint="Optional">
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="START DATE" hint="Empty = starts immediately">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="END DATE">
                <input
                  type="date"
                  value={endDate}
                  disabled={unlimited}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={clsx(inputCls, unlimited && 'opacity-40')}
                />
              </Field>
            </div>

            <Toggle
              checked={unlimited}
              onChange={setUnlimited}
              label="No time limit"
              hint="The group stays active until an administrator archives or deletes it"
            />
            <Toggle
              checked={activateNow}
              onChange={setActivateNow}
              label="Activate immediately"
              hint="Off — the group is created as a draft and switched on later"
            />

            <div className="grid grid-cols-2 gap-3">
              <Field label="PRIORITY (0-100)">
                <input type="number" min={0} max={100} value={priority}
                  onChange={(e) => setPriority(+e.target.value)} className={inputCls} />
              </Field>
              <Field label="COLOR">
                <div className="flex gap-2 flex-wrap pt-1">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setColor(c)}
                      className={clsx('w-7 h-7 rounded border-2 transition-transform',
                        color === c ? 'border-white scale-110' : 'border-transparent')}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </Field>
            </div>

            <Toggle checked={isPrivate} onChange={setIsPrivate} label="Private group" />
          </div>
        )}

        {/* ── Шаг 2: участники ──────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-3">
            <Field
              label="CALLSIGNS"
              hint="One per line, or separated by commas. Extra spaces are removed, duplicates are collapsed."
            >
              <textarea
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
                rows={10}
                className={clsx(inputCls, 'resize-y')}
                placeholder={'BRIGADE-1\nBRIGADE-2\nBRIGADE-3'}
              />
            </Field>
            <div className="flex items-center gap-2 font-mono text-xs">
              <Users className="w-3.5 h-3.5 text-ptt-green" />
              <span className="text-ptt-green">{parsedCount}</span>
              <span className="text-ptt-muted">
                {parsedCount === 1 ? 'callsign entered' : 'callsigns entered'} — counted automatically
              </span>
            </div>
            <p className="font-mono text-ptt-muted text-[11px]">
              Latin letters, digits, hyphen and underscore. Conflicts with existing users are resolved at the preview step.
            </p>
          </div>
        )}

        {/* ── Шаг 3: роли и права ───────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <Field label="ROLE FOR NEW MEMBERS">
              <div className="space-y-1">
                {ROLES.map((r) => (
                  <label key={r.value} className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-ptt-dark/60">
                    <input type="radio" checked={role === r.value} onChange={() => setRole(r.value)}
                      className="mt-1 accent-ptt-green" />
                    <span>
                      <span className="font-rajdhani font-semibold text-sm text-white">{r.label}</span>
                      <span className="block font-mono text-ptt-muted text-[11px]">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label="PERMISSIONS INSIDE THIS GROUP">
              <Toggle checked={canSpeak} onChange={setCanSpeak}
                label="Voice — may transmit"
                hint="Off = observer: hears the channel but cannot talk" />
              <Toggle checked={canMessage} onChange={setCanMessage} label="Messages" />
              <Toggle checked={canShareLocation} onChange={setCanShareLocation} label="Location sharing" />
            </Field>

            <p className="font-mono text-ptt-muted text-[11px]">
              Sensors are granted per group on the Sensors page — an alert reaches everyone in the group it is bound to.
            </p>
          </div>
        )}

        {/* ── Шаг 4: учётные данные ─────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded border border-ptt-green/30 bg-ptt-green/5 p-3">
              <p className="font-mono text-xs text-ptt-green mb-1">PERSONAL QR IS THE MAIN WAY IN</p>
              <p className="font-mono text-ptt-muted text-[11px]">
                Every member gets an individual QR code. Login and password stay as a fallback.
              </p>
            </div>

            <Field label="PASSWORDS">
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-ptt-dark/60">
                <input type="radio" checked={passwordMode === 'individual'}
                  onChange={() => setPasswordMode('individual')} className="mt-1 accent-ptt-green" />
                <span>
                  <span className="font-rajdhani font-semibold text-sm text-white">Individual temporary passwords</span>
                  <span className="block font-mono text-ptt-muted text-[11px]">Recommended. Shown once, stored only as hashes.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-ptt-dark/60">
                <input type="radio" checked={passwordMode === 'shared'}
                  onChange={() => setPasswordMode('shared')} className="mt-1 accent-ptt-danger" />
                <span>
                  <span className="font-rajdhani font-semibold text-sm text-white">One shared password</span>
                  <span className="block font-mono text-ptt-muted text-[11px]">Convenient, but anyone can sign in as anyone else.</span>
                </span>
              </label>
            </Field>

            {passwordMode === 'shared' && (
              <div className="rounded border border-ptt-danger/40 bg-ptt-danger/5 p-3 space-y-2">
                <p className="flex items-center gap-2 font-mono text-xs text-ptt-danger">
                  <ShieldAlert className="w-3.5 h-3.5" /> SECURITY RISK
                </p>
                <p className="font-mono text-ptt-muted text-[11px]">
                  With one shared password any member can sign in under another callsign. The activity log then shows
                  the wrong person. Use only for short exercises.
                </p>
                <input
                  value={sharedPassword}
                  onChange={(e) => setSharedPassword(e.target.value)}
                  className={inputCls}
                  placeholder="At least 8 characters, letters and digits"
                />
                <Toggle danger checked={acknowledgeSharedRisk} onChange={setAcknowledgeSharedRisk}
                  label="I understand the risk and take responsibility" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="INVITE VALID FOR (DAYS)">
                <input type="number" min={1} max={365} value={inviteDays}
                  onChange={(e) => setInviteDays(+e.target.value)} className={inputCls} />
              </Field>
              <Field label="INVITE REUSE">
                <select value={singleUse ? 'once' : 'many'} onChange={(e) => setSingleUse(e.target.value === 'once')}
                  className={inputCls}>
                  <option value="once">Single use</option>
                  <option value="many">Reusable until expiry</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* ── Шаг 5: предварительный просмотр ───────────────── */}
        {step === 4 && preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'TO CREATE', value: preview.totals.toCreate, cls: 'text-ptt-green' },
                { label: 'EXISTING', value: preview.totals.existing, cls: 'text-ptt-blue' },
                { label: 'REJECTED', value: preview.totals.rejected, cls: preview.totals.rejected ? 'text-ptt-danger' : 'text-ptt-muted' },
                { label: 'QR CODES', value: activeCount, cls: 'text-white' },
              ].map((s) => (
                <div key={s.label} className="rounded border border-ptt-border bg-ptt-dark p-2 text-center">
                  <p className={clsx('font-orbitron text-lg', s.cls)}>{s.value}</p>
                  <p className="font-mono text-ptt-muted text-[10px] tracking-widest">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="rounded border border-ptt-border bg-ptt-dark p-3 font-mono text-xs space-y-1">
              <p className="text-white">{preview.group.name}</p>
              <p className="text-ptt-muted">
                {preview.organization.name} · status {preview.group.status} ·{' '}
                {preview.group.unlimited ? 'no time limit' : `until ${new Date(preview.group.endsAt!).toLocaleDateString()}`}
              </p>
            </div>

            {preview.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 font-mono text-ptt-warn text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {w}
              </p>
            ))}

            <div className="border border-ptt-border rounded overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="bg-ptt-dark sticky top-0">
                    <tr className="font-mono text-ptt-muted text-[10px] tracking-widest">
                      <th className="px-3 py-2">CALLSIGN</th>
                      <th className="px-3 py-2">LOGIN</th>
                      <th className="px-3 py-2">STATUS</th>
                      <th className="px-3 py-2">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const action = actions[r.callsign] ?? r.defaultAction;
                      return (
                        <tr key={r.callsign} className="border-t border-ptt-border/40">
                          <td className="px-3 py-2 callsign text-xs">{r.callsign}</td>
                          <td className="px-3 py-2 font-mono text-xs text-ptt-text">
                            {r.status === 'NEW' ? r.login : r.existing?.login ?? r.existing?.email ?? '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            {r.status === 'NEW' && <span className="text-ptt-green">new</span>}
                            {r.status === 'EXISTING' && (
                              <span className="text-ptt-blue" title={r.existing?.displayName}>
                                already exists
                              </span>
                            )}
                            {r.status === 'REJECTED' && (
                              <span className="text-ptt-danger" title={r.error}>rejected</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {r.status === 'REJECTED' ? (
                              <span className="font-mono text-[11px] text-ptt-muted">{r.error}</span>
                            ) : (
                              <select
                                value={action}
                                onChange={(e) =>
                                  setActions({ ...actions, [r.callsign]: e.target.value as PreviewRow['defaultAction'] })
                                }
                                className="bg-ptt-dark border border-ptt-border rounded px-2 py-1 font-mono text-[11px] text-white"
                              >
                                {r.status === 'EXISTING' && <option value="use_existing">Use existing user</option>}
                                {r.status === 'NEW' && <option value="create">Create new</option>}
                                <option value="skip">Skip</option>
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="font-mono text-ptt-muted text-[11px]">
              Nothing has been created yet. The group, users and invitations appear only after you press CREATE.
            </p>
          </div>
        )}

        {/* ── Шаг 6: результат ──────────────────────────────── */}
        {step === 5 && result && (
          <div className="space-y-4">
            <div className="rounded border border-ptt-green/40 bg-ptt-green/5 p-3">
              <p className="font-orbitron text-ptt-green text-sm">
                {result.group.name} — {existingGroup ? 'MEMBERS ADDED' : 'CREATED'}
              </p>
              <p className="font-mono text-ptt-muted text-[11px] mt-1">
                {result.organization.name} · status {result.group.status} ·{' '}
                {result.group.unlimited ? 'no time limit' : `until ${new Date(result.group.endsAt!).toLocaleDateString()}`}
                {' · '}{result.members.length} {existingGroup ? 'added' : 'members'} · {result.invites.count} invitations
              </p>
            </div>

            <div className="rounded border border-ptt-warn/40 bg-ptt-warn/5 p-3">
              <p className="flex items-center gap-2 font-mono text-xs text-ptt-warn">
                <KeyRound className="w-3.5 h-3.5" /> SAVE THIS NOW — SHOWN ONLY ONCE
              </p>
              <p className="font-mono text-ptt-muted text-[11px] mt-1">
                Passwords and invitation links are stored as hashes only. They cannot be shown again — a lost one can
                only be reissued.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  openInviteSheet(result.group.name, result.organization.name, result.members, result.invites.expiresAt)
                }
                className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-3 py-1.5 rounded tracking-widest">
                <Printer className="w-3 h-3" /> PRINT ALL QR
              </button>
              <button
                onClick={() =>
                  saveInvitePdf(result.group.name, result.organization.name, result.members, result.invites.expiresAt)
                }
                className="flex items-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs px-3 py-1.5 rounded hover:text-white">
                <FileDown className="w-3 h-3" /> SAVE PDF
              </button>
              <button onClick={downloadCsv}
                className="flex items-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs px-3 py-1.5 rounded hover:text-white">
                <Download className="w-3 h-3" /> CSV
              </button>
              <button onClick={() => copy(credentialsCsv(result.members), 'all')}
                className="flex items-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs px-3 py-1.5 rounded hover:text-white">
                <Copy className="w-3 h-3" /> {copied === 'all' ? 'COPIED' : 'COPY ALL'}
              </button>
              <button onClick={() => setShowSecrets(!showSecrets)}
                className="flex items-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs px-3 py-1.5 rounded hover:text-white">
                {showSecrets ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showSecrets ? 'HIDE' : 'SHOW'} PASSWORDS
              </button>
            </div>

            {result.sharedPassword && (
              <p className="font-mono text-xs text-ptt-danger">
                Shared password for everyone: {showSecrets ? result.sharedPassword : '••••••••'}
              </p>
            )}

            <div className="border border-ptt-border rounded overflow-hidden">
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="bg-ptt-dark sticky top-0">
                    <tr className="font-mono text-ptt-muted text-[10px] tracking-widest">
                      <th className="px-3 py-2">QR</th>
                      <th className="px-3 py-2">CALLSIGN</th>
                      <th className="px-3 py-2">LOGIN</th>
                      <th className="px-3 py-2">PASSWORD</th>
                      <th className="px-3 py-2">INVITE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.members.map((m) => (
                      <tr key={m.userId} className="border-t border-ptt-border/40">
                        <td className="px-3 py-2">
                          <button
                            onClick={() => setZoomedQr(m)}
                            title="Enlarge"
                            className="block rounded hover:ring-2 hover:ring-ptt-green transition-shadow"
                          >
                            <QrCode value={m.inviteUrl} size={72} alt={`QR for ${m.callsign}`} />
                          </button>
                        </td>
                        <td className="px-3 py-2 callsign text-xs">
                          {m.callsign}
                          {!m.isNew && <span className="ml-2 font-mono text-[10px] text-ptt-blue">existing</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ptt-text">{m.login ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-white">
                          {m.tempPassword ? (showSecrets ? m.tempPassword : '••••••••') : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {/* Готовое сообщение — одна вставка в WhatsApp или Telegram. */}
                            <button
                              onClick={() => shareOrCopy(m, `msg-${m.userId}`)}
                              className="flex items-center gap-1 font-mono text-[11px] text-ptt-green hover:text-white">
                              <Send className="w-3 h-3" />
                              {copied === `msg-${m.userId}` ? 'copied!' : 'message'}
                            </button>
                            <button
                              onClick={() => shareCard(m, `card-${m.userId}`)}
                              disabled={cardBusy === `card-${m.userId}` || (!cards[m.userId] && !cardsReady)}
                              className="flex items-center gap-1 font-mono text-[11px] text-ptt-blue hover:text-white disabled:opacity-50">
                              <ImageIcon className="w-3 h-3" />
                              {cardBusy === `card-${m.userId}`
                                ? '...'
                                : cardState?.tag === `card-${m.userId}`
                                  ? (cardState.state === 'copied' ? 'copied!' : 'saved to file')
                                  : cards[m.userId] ? 'card' : 'preparing'}
                            </button>
                            <button onClick={() => copy(m.inviteUrl, m.userId)}
                              className="flex items-center gap-1 font-mono text-[11px] text-ptt-muted hover:text-white">
                              <Link2 className="w-3 h-3" />
                              {copied === m.userId ? 'copied' : 'link only'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded border border-ptt-border bg-ptt-dark p-3 space-y-1.5">
              <p className="font-mono text-ptt-text text-[11px] tracking-widest">HOW TO SEND ONE INVITATION</p>
              <p className="font-mono text-ptt-muted text-[11px]">
                In Telegram or WhatsApp, send the card as a <b className="text-ptt-text">photo</b> and the text as its
                <b className="text-ptt-text"> caption</b> — one message that works both ways: a phone taps the link, a
                computer screen gets scanned with a camera. A link inside an image is not tappable, which is why the
                text goes with it.
              </p>
              <p className="font-mono text-ptt-muted text-[11px]">
                1. <b className="text-ptt-text">card</b> → paste into the chat &nbsp;·&nbsp;
                2. <b className="text-ptt-text">message</b> → paste into the caption field &nbsp;·&nbsp; 3. send
              </p>
              <p className="font-mono text-ptt-muted text-[11px]">
                On a phone one tap on <b className="text-ptt-text">card</b> is enough — the share sheet sends the image
                and the text together.
              </p>
              <p className="font-mono text-ptt-warn text-[11px]">
                Scanning off this screen? <b>Click the QR first</b> — the thumbnail is too small for a phone camera,
                the enlarged one reads instantly.
              </p>
            </div>
          </div>
        )}

        {/* Увеличенный QR: показать с экрана или отсканировать вживую */}
        {zoomedQr && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setZoomedQr(null)}
          >
            <div className="card p-5 text-center max-w-sm" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <p className="callsign text-sm">{zoomedQr.callsign}</p>
                <button onClick={() => setZoomedQr(null)} className="text-ptt-muted hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex justify-center bg-white p-3 rounded">
                <QrCode value={zoomedQr.inviteUrl} size={260} alt={`QR for ${zoomedQr.callsign}`} />
              </div>

              <p className="font-mono text-ptt-muted text-[10px] mt-3 break-all">{zoomedQr.inviteUrl}</p>

              {zoomedQr.login && (
                <p className="font-mono text-xs text-ptt-text mt-2">
                  {zoomedQr.login} · {showSecrets ? zoomedQr.tempPassword : '••••••••'}
                </p>
              )}

              <div className="space-y-2 mt-4">
                <button onClick={() => shareOrCopy(zoomedQr, `zoommsg-${zoomedQr.userId}`)}
                  className="w-full flex items-center justify-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs py-2 rounded tracking-widest">
                  <Send className="w-3 h-3" />
                  {copied === `zoommsg-${zoomedQr.userId}` ? 'MESSAGE COPIED' : 'SEND TO MESSENGER'}
                </button>
                <div className="flex gap-2">
                  <button onClick={() => downloadQr(zoomedQr.inviteUrl, `${zoomedQr.callsign}-invite`)}
                    className="flex-1 flex items-center justify-center gap-2 border border-ptt-border text-ptt-text font-mono text-xs py-2 rounded hover:text-white">
                    <QrIcon className="w-3 h-3" /> SAVE PNG
                  </button>
                  <button onClick={() => copy(zoomedQr.inviteUrl, `zoom-${zoomedQr.userId}`)}
                    className="flex-1 border border-ptt-border text-ptt-text font-mono text-xs py-2 rounded hover:text-white">
                    {copied === `zoom-${zoomedQr.userId}` ? 'COPIED' : 'COPY LINK'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 font-mono text-ptt-danger text-xs mt-4">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        )}

        {/* Навигация */}
        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-ptt-border">
          {step > firstStep && step < 5 && (
            <button onClick={() => { setStep(step - 1); setError(''); }}
              className="flex items-center gap-1 font-mono text-xs text-ptt-muted hover:text-white">
              <ArrowLeft className="w-3 h-3" /> BACK
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {step < 3 && (
              <button
                onClick={() => setStep(step + 1)}
                disabled={(step === 0 && !canLeaveStep1) || (step === 1 && !canLeaveStep2)}
                className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-4 py-2 rounded tracking-widest disabled:opacity-40">
                NEXT <ArrowRight className="w-3 h-3" />
              </button>
            )}

            {step === 3 && (
              <button onClick={loadPreview} disabled={loading || !canLeaveStep4}
                className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-4 py-2 rounded tracking-widest disabled:opacity-40">
                {loading ? 'CHECKING...' : <>PREVIEW <ArrowRight className="w-3 h-3" /></>}
              </button>
            )}

            {step === 4 && (
              <button onClick={handleCreate} disabled={loading || activeCount === 0}
                className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-xs px-4 py-2 rounded tracking-widest disabled:opacity-40">
                <UserPlus className="w-3 h-3" />
                {loading ? 'CREATING...' : `CREATE (${activeCount})`}
              </button>
            )}

            {step === 5 && (
              <button onClick={onClose}
                className="bg-ptt-green text-ptt-dark font-orbitron text-xs px-4 py-2 rounded tracking-widest">
                DONE
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
