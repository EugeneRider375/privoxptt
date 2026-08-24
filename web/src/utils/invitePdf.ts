import type { CreatedMember } from '@/types';

/**
 * Сохранение листа приглашений в PDF-файл.
 *
 * Раньше формат был только один — печать, и в комментарии рядом стояло, что
 * диалог печати сам умеет «Сохранить как PDF», значит отдельного пути не надо.
 * На практике оказалось не так: до этого пункта в диалоге ещё надо догадаться,
 * а если диалог закрыть, лист остаётся без единой кнопки. Поэтому здесь —
 * прямое сохранение файла, без диалога вообще.
 *
 * ⚠️ jsPDF подключается ДИНАМИЧЕСКИ и намеренно. Библиотека весит сотни
 * килобайт, а нужна одному администратору раз в жизни группы. Веб грузят рации
 * и телефоны, иногда по слабой связи, — раздавать этот вес всем ради админской
 * кнопки нельзя. При статическом импорте он попал бы в общий бандл.
 */

const PAGE = { width: 210, height: 297 };          // A4 в миллиметрах
const MARGIN = 12;
const GAP = 6;
const CARD = { width: (PAGE.width - MARGIN * 2 - GAP) / 2, height: 46 };
const QR = 34;

/**
 * Встроенные шрифты jsPDF знают только Latin-1. Позывные латиницей гарантирует
 * сам сервер (`validateCallsign` отвергает кириллицу), а вот отображаемое имя
 * ничем не ограничено — там «Дежурный» вполне возможен.
 *
 * Без этой страховки такое имя молча превращалось бы в «2 0 = 5 B @ > 2», и
 * человек получал бы карточку с мусором вместо имени. Лучше не показать строку
 * вовсе: позывной рядом никуда не делся и опознаёт человека сам.
 */
function latin1(text: string): string | null {
  const clean = [...text].filter((ch) => ch.codePointAt(0)! <= 0xff).join('').trim();
  return clean.length > 0 ? clean : null;
}

function fileName(groupName: string): string {
  const safe = groupName.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'invitations';
  return `${safe}-invitations.pdf`;
}

/**
 * Раскладка вынесена отдельно и принимает уже готовые QR — чтобы её можно было
 * прогнать в Node и посмотреть на настоящий файл, а не поверить на слово.
 * Отрисовка QR требует браузера, а сама вёрстка страницы — нет.
 */
export async function buildInvitePdf(
  groupName: string,
  organizationName: string,
  members: CreatedMember[],
  expiresAt: string,
  codes: string[],
) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(latin1(groupName) ?? 'Invitations', MARGIN, MARGIN + 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `${latin1(organizationName) ?? ''} · ${members.length} invitations · valid until ${new Date(expiresAt).toLocaleDateString()}`,
      MARGIN,
      MARGIN + 7,
    );
    doc.setTextColor(0);
    doc.setDrawColor(30);
    doc.line(MARGIN, MARGIN + 10, PAGE.width - MARGIN, MARGIN + 10);
  };

  header();
  let x = MARGIN;
  let y = MARGIN + 14;

  members.forEach((member, index) => {
    // Карточку не разрываем между страницами — иначе QR уедет пополам.
    if (y + CARD.height > PAGE.height - MARGIN) {
      doc.addPage();
      header();
      x = MARGIN;
      y = MARGIN + 14;
    }

    doc.setDrawColor(180);
    doc.roundedRect(x, y, CARD.width, CARD.height, 2, 2);
    doc.addImage(codes[index], 'PNG', x + 3, y + (CARD.height - QR) / 2, QR, QR);

    const textX = x + QR + 7;
    const textW = CARD.width - QR - 10;
    let textY = y + 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(member.callsign, textX, textY);

    const shownName = latin1(member.displayName);
    if (shownName) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(90);
      textY += 4.5;
      doc.text(shownName, textX, textY, { maxWidth: textW });
      doc.setTextColor(0);
    }

    textY += 5.5;
    if (member.login) {
      doc.setFont('courier', 'normal');
      doc.text(`Login     ${member.login}`, textX, textY, { maxWidth: textW });
      textY += 4;
      doc.text(`Password  ${member.tempPassword ?? '—'}`, textX, textY, { maxWidth: textW });
      textY += 4;
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(90);
      doc.text('Existing account — usual credentials', textX, textY, { maxWidth: textW });
      doc.setTextColor(0);
      textY += 4;
    }

    // Ссылка обязательна рядом с QR: приглашение часто пересылают в мессенджере
    // на тот же телефон, и сканировать код с собственного экрана нечем.
    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(70);
    const urlLines = doc.splitTextToSize(member.inviteUrl, textW) as string[];
    doc.text(urlLines, textX, textY + 3);
    // Ссылку делаем ещё и кликабельной. Она длинная и переносится на две
    // строки, поэтому при копировании внутрь попадёт перенос — а по нажатию
    // открывается целиком, и копировать не нужно вовсе.
    doc.link(textX, textY, textW, urlLines.length * 2.4 + 2, { url: member.inviteUrl });
    doc.setTextColor(0);

    if (index % 2 === 0) {
      x = MARGIN + CARD.width + GAP;
    } else {
      x = MARGIN;
      y += CARD.height + GAP;
    }
  });

  return doc;
}

export async function saveInvitePdf(
  groupName: string,
  organizationName: string,
  members: CreatedMember[],
  expiresAt: string,
): Promise<void> {
  // QR рисуем заранее: внутри отрисовки страницы ждать нельзя. Импорт
  // отложенный — тогда сама раскладка грузится без браузерных зависимостей и
  // её можно прогнать в Node, чтобы посмотреть на настоящий файл.
  const { renderQrDataUrl } = await import('@/components/ui/QrCode');
  const codes = await Promise.all(members.map((m) => renderQrDataUrl(m.inviteUrl, 512)));
  const doc = await buildInvitePdf(groupName, organizationName, members, expiresAt, codes);
  doc.save(fileName(groupName));
}
