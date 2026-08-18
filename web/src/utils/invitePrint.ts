import type { CreatedMember } from '@/types';
import { renderQrDataUrl } from '@/components/ui/QrCode';

/**
 * Печатный лист приглашений: по карточке на участника — QR, позывной, логин,
 * временный пароль и обычная ссылка.
 *
 * Сделано печатью, а не ZIP-архивом, потому что реально с этим делают именно
 * это: печатают, разрезают и раздают людям на руки. Заодно диалог печати в
 * macOS и iOS умеет «Сохранить как PDF», так что отдельный формат не нужен.
 *
 * Рядом с QR всегда есть кликабельная ссылка — приглашение часто пересылают в
 * мессенджере на тот же телефон, и сканировать код с собственного экрана нечем.
 */
export async function openInviteSheet(
  groupName: string,
  organizationName: string,
  members: CreatedMember[],
  expiresAt: string
): Promise<void> {
  const cards = await Promise.all(
    members.map(async (m) => {
      const qr = await renderQrDataUrl(m.inviteUrl, 512);
      const secrets = m.login
        ? `<p class="row"><span>Login</span><b>${esc(m.login)}</b></p>
           <p class="row"><span>Password</span><b>${esc(m.tempPassword ?? '—')}</b></p>`
        : `<p class="row existing">Existing account — sign in with your usual credentials</p>`;

      return `
        <section class="card">
          <img src="${qr}" alt="QR" />
          <div class="info">
            <h2>${esc(m.callsign)}</h2>
            <p class="sub">${esc(m.displayName)}</p>
            ${secrets}
            <p class="link">${esc(m.inviteUrl)}</p>
          </div>
        </section>`;
    })
  );

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(groupName)} — invitations</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #111; }
  header { margin-bottom: 20px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; font-size: 12px; color: #555; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .card { display: flex; gap: 14px; border: 1px solid #bbb; border-radius: 8px; padding: 12px;
          /* Карточку нельзя разрывать между страницами — иначе QR уедет пополам. */
          break-inside: avoid; page-break-inside: avoid; }
  .card img { width: 128px; height: 128px; flex-shrink: 0; }
  .info { min-width: 0; }
  .info h2 { margin: 0; font-size: 17px; letter-spacing: 0.5px; }
  .sub { margin: 2px 0 8px; font-size: 12px; color: #555; }
  .row { margin: 2px 0; font-size: 12px; }
  .row span { display: inline-block; width: 68px; color: #555; }
  .row b { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .existing { color: #555; font-style: italic; }
  .link { margin: 8px 0 0; font-family: ui-monospace, Menlo, monospace; font-size: 9px;
          color: #444; word-break: break-all; }
  footer { margin-top: 18px; font-size: 11px; color: #666; }
  @media print { body { margin: 10mm; } .no-print { display: none; } }
</style>
</head>
<body>
  <header>
    <h1>${esc(groupName)}</h1>
    <p>${esc(organizationName)} · ${members.length} invitations · valid until ${new Date(expiresAt).toLocaleDateString()}</p>
  </header>
  <div class="cards">${cards.join('')}</div>
  <footer>
    Scan the QR code with the phone camera, or open the link below it. Temporary passwords must be changed after the first sign-in.
  </footer>
  <script>window.addEventListener('load', () => window.print());<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    // Блокировщик всплывающих окон — говорим об этом прямо, а не молчим.
    alert('Allow pop-up windows for this site to open the printable invitation sheet.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

/**
 * Готовое сообщение для мессенджера — одна вставка, и всё на месте.
 *
 * Картинку QR сюда намеренно не кладём: если приглашение приходит на тот же
 * телефон, куда ставят приложение, сканировать код нечем — человек просто
 * нажимает ссылку. QR нужен для другого случая: показать код со своего экрана.
 */
export function buildInviteMessage(
  member: CreatedMember,
  groupName: string,
  expiresAt: string
): string {
  const lines = [
    `PRIVOX PTT — ${groupName}`,
    `Callsign: ${member.callsign}`,
    '',
    'Open this link on your phone:',
    member.inviteUrl,
  ];

  if (member.login) {
    lines.push('', `Backup sign-in: ${member.login} / ${member.tempPassword ?? ''}`);
  } else {
    lines.push('', 'Sign in with your usual credentials.');
  }

  lines.push('', `The link is valid until ${new Date(expiresAt).toLocaleDateString()}.`);
  return lines.join('\n');
}

/**
 * Системное «Поделиться». Там, где браузер это умеет (телефон, Safari),
 * открывается обычный лист выбора — WhatsApp, Telegram, почта.
 * Где не умеет — возвращаем false, и вызывающий код просто копирует текст.
 */
export async function shareInvite(text: string, title: string): Promise<boolean> {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch (err) {
    // Пользователь закрыл лист выбора — это не ошибка, молчим.
    if ((err as Error)?.name === 'AbortError') return true;
    return false;
  }
}

/** Экранирование: позывные и имена приходят от пользователя. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
