import { useState } from 'react';
import { Link2, X } from 'lucide-react';

import { QrCode, downloadQr } from '@/components/ui/QrCode';
import { openInviteSheet } from '@/utils/invitePrint';
import { saveInvitePdf } from '@/utils/invitePdf';

export interface FreshLink {
  inviteId: string;
  userId: string;
  callsign: string;
  displayName: string;
  login: string | null;
  url: string;
  expiresAt: string;
}

/**
 * QR + ссылка + необязательный пароль + печать/PDF для ОДНОГО человека —
 * общий кусок между "перевыпустить приглашение внутри группы"
 * (`GroupInvites.tsx`) и "сгенерировать карточку" из общего списка
 * пользователей (`AdminUsers.tsx`, D36). Раньше существовал только в
 * GroupInvites.tsx и не показывал пароль вообще — вынесен сюда, чтобы не
 * дублировать копипастой во втором месте.
 *
 * Пароль существующего пользователя нам не известен (в базе только хеш) —
 * если админ сам его помнит, он вписывает его сам; поле нигде не
 * сохраняется на сервер, только для печати/PDF в этом же браузере.
 */
export function IndividualInviteCard({
  groupName, organizationName, fresh, onClose,
}: {
  groupName: string;
  organizationName: string;
  fresh: FreshLink;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(fresh.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const member = {
    userId: fresh.userId,
    callsign: fresh.callsign,
    displayName: fresh.displayName,
    login: fresh.login,
    isNew: false,
    tempPassword: password || null,
    inviteId: fresh.inviteId,
    inviteUrl: fresh.url,
  };

  return (
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
          <p className="font-mono text-ptt-muted text-[11px] mt-1">
            Tell them: point your phone camera at the code, then tap JOIN.
            Need help or a different phone? ptt.privox.tech/download
          </p>
        </div>
        <button onClick={onClose} className="text-ptt-muted hover:text-white shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* 200 точек: с экрана монитора камера телефона берёт уверенно,
            96 точек читались с трудом или не читались вовсе. */}
        <div className="bg-white p-2 rounded shrink-0">
          <QrCode value={fresh.url} size={200} alt={`QR for ${fresh.callsign}`} />
        </div>
        <div className="min-w-0 space-y-2 w-full">
          <p className="font-mono text-ptt-muted text-[10px] break-all">{fresh.url}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={copyLink}
              className="flex items-center gap-1 border border-ptt-border text-ptt-text font-mono text-[11px] px-2 py-1 rounded hover:text-white">
              <Link2 className="w-3 h-3" /> {copied ? 'copied' : 'copy link'}
            </button>
            <button onClick={() => downloadQr(fresh.url, `${fresh.callsign}-invite`)}
              className="flex items-center gap-1 border border-ptt-border text-ptt-text font-mono text-[11px] px-2 py-1 rounded hover:text-white">
              save png
            </button>
          </div>

          {fresh.login && (
            <>
              <label className="block font-mono text-[10px] text-ptt-muted mt-2">
                Password (optional — only if you already know it; we can't read it back from the
                database). Leave empty to print without a password.
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Type the existing password to include it on the card"
                className="w-full bg-ptt-dark border border-ptt-border rounded px-2 py-1 font-mono text-xs text-white"
              />
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => openInviteSheet(groupName, organizationName, [member], fresh.expiresAt)}
              className="flex items-center gap-2 bg-ptt-green text-ptt-dark font-orbitron text-[11px] px-2 py-1 rounded tracking-widest"
            >
              PRINT CARD
            </button>
            <button
              onClick={() => saveInvitePdf(groupName, organizationName, [member], fresh.expiresAt)}
              className="flex items-center gap-2 border border-ptt-border text-ptt-text font-mono text-[11px] px-2 py-1 rounded tracking-widest hover:text-white"
            >
              SAVE PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
