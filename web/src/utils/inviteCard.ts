import type { CreatedMember } from '@/types';
import { renderQrDataUrl } from '@/components/ui/QrCode';

/**
 * Карточка приглашения одной картинкой: QR плюс всё, что нужно человеку.
 *
 * Зачем: приглашение отправляют в мессенджер, а читают его по-разному.
 * С телефона — нажимают ссылку в тексте. С компьютера (Telegram Desktop,
 * WhatsApp Web) ссылка бесполезна: приложение ставится на телефон, значит
 * нужно навести камеру на экран. Картинка закрывает оба случая сразу, и
 * отправлять её нужно один раз, а не двумя сообщениями.
 *
 * Рисуем на canvas, без сторонних библиотек: шрифты системные.
 */

const CARD_WIDTH = 1000;
const CARD_HEIGHT = 420;
const QR_SIZE = 320;
const PADDING = 40;

export async function renderInviteCard(
  member: CreatedMember,
  groupName: string,
  organizationName: string,
  expiresAt: string
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is not available');

  // Фон белый: QR должен читаться, а карточку часто ещё и печатают.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.strokeStyle = '#D4D4D4';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);

  // Фирменная полоса слева.
  ctx.fillStyle = '#3DDC84';
  ctx.fillRect(0, 0, 8, CARD_HEIGHT);

  // ── QR ──────────────────────────────────────────────────
  const qrImg = await loadImage(await renderQrDataUrl(member.inviteUrl, QR_SIZE * 2));
  const qrX = PADDING;
  const qrY = (CARD_HEIGHT - QR_SIZE) / 2;
  ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);

  // ── Текст ───────────────────────────────────────────────
  const textX = qrX + QR_SIZE + 36;
  const textW = CARD_WIDTH - textX - PADDING;
  let y = qrY + 8;

  ctx.fillStyle = '#0A0C0A';
  ctx.font = 'bold 30px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('PRIVOX PTT', textX, y);
  y += 34;

  ctx.fillStyle = '#666666';
  ctx.font = '19px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(truncate(ctx, `${groupName} · ${organizationName}`, textW), textX, y);
  y += 44;

  ctx.fillStyle = '#0A0C0A';
  ctx.font = 'bold 42px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.fillText(truncate(ctx, member.callsign, textW), textX, y);
  y += 46;

  ctx.font = '18px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#333333';

  if (member.login) {
    ctx.fillText(`Login:  ${member.login}`, textX, y);
    y += 26;
    ctx.fillText(`Password:  ${member.tempPassword ?? '—'}`, textX, y);
    y += 30;
  } else {
    ctx.fillStyle = '#666666';
    ctx.fillText('Existing account — use your usual credentials', textX, y);
    y += 30;
    ctx.fillStyle = '#333333';
  }

  ctx.fillStyle = '#666666';
  ctx.font = '15px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Point your phone camera at the code, then tap JOIN.', textX, y);
  y += 20;
  ctx.fillText('No app needed to start — link below if the camera can’t open it:', textX, y);
  y += 22;

  // Ссылка длинная — переносим, иначе она уедет за край карточки.
  ctx.fillStyle = '#1A6FD4';
  ctx.font = '14px ui-monospace, Menlo, monospace';
  for (const line of wrap(ctx, member.inviteUrl, textW)) {
    ctx.fillText(line, textX, y);
    y += 19;
  }

  y += 12;
  ctx.fillStyle = '#888888';
  ctx.font = '14px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`Valid until ${new Date(expiresAt).toLocaleDateString()}`, textX, y);
  y += 20;

  // Одна строка на случай, если QR не читается или человек открывает
  // карточку позже с другого телефона — полная инструкция уже есть на
  // /download (шаги под Android и iPhone, вход по логину/паролю).
  ctx.fillStyle = '#999999';
  ctx.font = '13px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Need help or a different phone? ptt.privox.tech/download', textX, y);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/** Умеет ли браузер вообще класть картинку в буфер. Проверка синхронная. */
export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
}

/**
 * Карточка в буфер обмена — чтобы вставить прямо в окно мессенджера.
 *
 * ВАЖНО: принимаем ОБЕЩАНИЕ картинки, а не готовую картинку, и вызываем
 * clipboard.write синхронно по нажатию кнопки. Браузер разрешает запись в
 * буфер только «по горячим следам» пользовательского жеста; если сначала
 * дождаться отрисовки canvas, а потом писать, разрешение уже сгорит и
 * запись молча провалится. Именно из-за этого в мессенджер уходил один
 * текст без картинки. ClipboardItem умеет принимать Promise<Blob> —
 * это и есть штатный способ обойти ограничение.
 */
export function copyInviteCard(blobPromise: Promise<Blob>): Promise<boolean> {
  if (!canCopyImage()) return Promise.resolve(false);
  try {
    const item = new ClipboardItem({ 'image/png': blobPromise });
    return navigator.clipboard.write([item]).then(
      () => true,
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Системное «Поделиться» вместе с картинкой — на телефоне это отправляет
 * текст и карточку одним действием в выбранное приложение.
 */
export async function shareInviteCard(
  blob: Blob,
  text: string,
  title: string,
  filename: string
): Promise<boolean> {
  if (!navigator.share || !navigator.canShare) return false;
  const file = new File([blob], filename, { type: 'image/png' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ title, text, files: [file] });
    return true;
  } catch (err) {
    // Закрытый лист выбора — не ошибка.
    return (err as Error)?.name === 'AbortError';
  }
}

// ── Мелкие помощники рисования ─────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('QR image failed to load'));
    img.src = src;
  });
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/** Перенос по символам: ссылка — одно длинное «слово», по пробелам её не разбить. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}
