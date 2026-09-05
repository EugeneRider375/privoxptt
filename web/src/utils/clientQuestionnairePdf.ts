/**
 * Печатная анкета для переговоров с потенциальным клиентом — RU, для
 * личного использования Eugene на встречах (не публичная страница, кнопка
 * доступна только SUPERADMIN в AdminLayout). Заполняется от руки на бумаге
 * прямо во время разговора: чекбоксы и линии для рукописного текста.
 *
 * Тот же приём со встроенным шрифтом, что и в userGuidePdf.ts — встроенные
 * шрифты jsPDF не знают кириллицу.
 */

const REGULAR_FONT_URL = '/fonts/PTSans-Regular.ttf';
const BOLD_FONT_URL = '/fonts/PTSans-Bold.ttf';
const FONT_NAME = 'PTSans';

const PAGE_MARGIN_PT = 42;
const BODY_SIZE = 10;
const LABEL_SIZE = 9;
const H1_SIZE = 17;
const H2_SIZE = 12;
const CHECKBOX_SIZE = 9;

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'fill'; label: string; lineWidthPt?: number }
  | { kind: 'checkboxes'; label?: string; items: string[] }
  | { kind: 'lines'; label: string; count: number }
  | { kind: 'space'; pt: number };

const BLOCKS: Block[] = [
  { kind: 'h1', text: 'PRIVOX PTT — анкета потенциального клиента' },
  { kind: 'fill', label: 'Дата встречи' },
  { kind: 'fill', label: 'Компания / объект' },
  { kind: 'fill', label: 'Контактное лицо' },
  { kind: 'fill', label: 'Проводил встречу' },

  { kind: 'h2', text: '1. Объект и связь' },
  { kind: 'fill', label: 'Тип объекта (склад, стройка, отель, производство, другое)' },
  { kind: 'fill', label: 'Площадь / территория покрытия' },
  { kind: 'checkboxes', label: 'Есть ли уже Wi-Fi / LTE-покрытие на объекте?', items: ['Да', 'Нет', 'Частично'] },

  { kind: 'h2', text: '2. Абоненты и структура' },
  { kind: 'fill', label: 'Количество абонентов' },
  { kind: 'fill', label: 'Количество групп / подразделений' },
  { kind: 'fill', label: 'Количество диспетчеров' },
  { kind: 'fill', label: 'Количество администраторов' },

  { kind: 'h2', text: '3. Устройства' },
  { kind: 'checkboxes', items: ['Рации носимые', 'Рации мобильные (транспорт)', 'Рации стационарные'] },
  { kind: 'fill', label: 'Смартфоны Android — количество' },
  { kind: 'fill', label: 'Смартфоны iPhone — количество' },
  { kind: 'checkboxes', label: 'Устройства уже есть в наличии?', items: ['Да', 'Нет'] },
  { kind: 'fill', label: 'Если есть — какие именно' },

  { kind: 'h2', text: '4. Датчики' },
  { kind: 'checkboxes', label: 'Нужны ли датчики?', items: ['Да', 'Нет', 'Пока не уверены'] },
  {
    kind: 'checkboxes',
    label: 'Какие типы',
    items: [
      'Температура / влажность',
      'Протечка / уровень воды',
      'Открытие двери',
      'Движение',
      'Парковка / занятость мест',
    ],
  },
  { kind: 'fill', label: 'Другое' },
  { kind: 'fill', label: 'Примерное количество точек' },

  { kind: 'h2', text: '5. Нужные функции' },
  {
    kind: 'checkboxes',
    items: [
      'Групповая связь (рация)',
      'Индивидуальные звонки',
      'Текстовые / голосовые сообщения',
      'Геолокация абонентов на карте',
    ],
  },
  {
    kind: 'checkboxes',
    items: [
      'Оповещение о прибытии в точку (геозона)',
      'Тревоги датчиков (push / на рацию)',
      'Журнал / отчёты по инцидентам',
      'Периодические отчёты руководителю (email)',
    ],
  },
  { kind: 'fill', label: 'Другое' },

  { kind: 'h2', text: '6. Пилот' },
  { kind: 'fill', label: 'Желаемые сроки старта' },
  { kind: 'fill', label: 'Бюджетные рамки / ограничения' },
  { kind: 'fill', label: 'Кто принимает решение' },

  { kind: 'h2', text: '7. Комментарии' },
  { kind: 'lines', label: '', count: 5 },

  { kind: 'h2', text: 'Контакты клиента' },
  { kind: 'fill', label: 'Имя' },
  { kind: 'fill', label: 'Телефон' },
  { kind: 'fill', label: 'Email' },
];

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function downloadClientQuestionnairePdf(): Promise<void> {
  const [{ jsPDF }, regularBase64, boldBase64] = await Promise.all([
    import('jspdf'),
    fetchFontBase64(REGULAR_FONT_URL),
    fetchFontBase64(BOLD_FONT_URL),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.addFileToVFS('PTSans-Regular.ttf', regularBase64);
  doc.addFont('PTSans-Regular.ttf', FONT_NAME, 'normal');
  doc.addFileToVFS('PTSans-Bold.ttf', boldBase64);
  doc.addFont('PTSans-Bold.ttf', FONT_NAME, 'bold');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PAGE_MARGIN_PT * 2;

  let y = PAGE_MARGIN_PT;

  function ensureSpace(nextHeight: number) {
    if (y + nextHeight > pageHeight - PAGE_MARGIN_PT) {
      doc.addPage();
      y = PAGE_MARGIN_PT;
    }
  }

  function heading(text: string, size: number, color: [number, number, number]) {
    ensureSpace(size * 1.6);
    doc.setFont(FONT_NAME, 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(text, PAGE_MARGIN_PT, y + size * 0.9);
    y += size * 1.6;
  }

  function fillLine(label: string) {
    const rowHeight = BODY_SIZE * 2.4;
    ensureSpace(rowHeight);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(LABEL_SIZE);
    doc.setTextColor(90, 90, 90);
    doc.text(label, PAGE_MARGIN_PT, y + LABEL_SIZE * 0.9);
    doc.setDrawColor(180, 180, 180);
    doc.line(PAGE_MARGIN_PT, y + rowHeight - 4, PAGE_MARGIN_PT + usableWidth, y + rowHeight - 4);
    y += rowHeight;
  }

  function checkbox(x: number, yTop: number) {
    doc.setDrawColor(60, 60, 60);
    doc.rect(x, yTop, CHECKBOX_SIZE, CHECKBOX_SIZE);
  }

  function checkboxesBlock(items: string[], label?: string) {
    if (label) {
      ensureSpace(BODY_SIZE * 1.6);
      doc.setFont(FONT_NAME, 'normal');
      doc.setFontSize(LABEL_SIZE);
      doc.setTextColor(90, 90, 90);
      doc.text(label, PAGE_MARGIN_PT, y + LABEL_SIZE * 0.9);
      y += BODY_SIZE * 1.6;
    }
    const rowHeight = BODY_SIZE * 1.9;
    ensureSpace(rowHeight);
    doc.setFont(FONT_NAME, 'normal');
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(20, 20, 20);
    let x = PAGE_MARGIN_PT;
    for (const item of items) {
      const textWidth = doc.getTextWidth(item);
      const itemWidth = CHECKBOX_SIZE + 6 + textWidth + 22;
      if (x + itemWidth > PAGE_MARGIN_PT + usableWidth) {
        y += rowHeight;
        ensureSpace(rowHeight);
        x = PAGE_MARGIN_PT;
      }
      checkbox(x, y);
      doc.text(item, x + CHECKBOX_SIZE + 6, y + CHECKBOX_SIZE - 1);
      x += itemWidth;
    }
    y += rowHeight + 4;
  }

  function linesBlock(count: number) {
    const lineHeight = BODY_SIZE * 2.2;
    for (let i = 0; i < count; i += 1) {
      ensureSpace(lineHeight);
      doc.setDrawColor(200, 200, 200);
      doc.line(PAGE_MARGIN_PT, y + lineHeight - 4, PAGE_MARGIN_PT + usableWidth, y + lineHeight - 4);
      y += lineHeight;
    }
  }

  for (const block of BLOCKS) {
    if (block.kind === 'h1') {
      heading(block.text, H1_SIZE, [10, 12, 10]);
      y += 6;
    } else if (block.kind === 'h2') {
      y += 8;
      heading(block.text, H2_SIZE, [10, 110, 58]);
      y += 2;
    } else if (block.kind === 'fill') {
      fillLine(block.label);
    } else if (block.kind === 'checkboxes') {
      checkboxesBlock(block.items, block.label);
    } else if (block.kind === 'lines') {
      linesBlock(block.count);
    } else if (block.kind === 'space') {
      y += block.pt;
    }
  }

  doc.save('privox-ptt-client-questionnaire.pdf');
}
