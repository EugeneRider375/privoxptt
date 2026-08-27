/**
 * Печатная инструкция для абонента — RU/EN/FR, одним файлом, скачивается
 * с публичной страницы /download (не привязана к конкретному человеку,
 * в отличие от inviteCard.ts/invitePdf.ts).
 *
 * Настоящий текстовый PDF (можно выделить/скопировать/искать), не картинка.
 * Встроенные шрифты jsPDF знают только Latin-1 — кириллица и французские
 * диакритики ими не рисуются. Решение — встроить свой шрифт с нужным
 * покрытием: PT Sans (ParaType, лицензия OFL, специально сделан под
 * кириллицу+латиницу), файлы лежат в web/public/fonts/. Загружаются лениво
 * (fetch), только когда кнопку реально нажали — незачем раздувать общий
 * JS-бандл ради функции, которой пользуется один администратор изредка.
 *
 * ⚠️ До этого варианта пробовали doc.html() (рендер через html2canvas) —
 * на практике отдавал пустые страницы (проверено 27.08.2026). Потом —
 * html2canvas напрямую с вставкой картинки — сработало визуально, но текст
 * получился нескопируемым (это и есть картинка). Только embed-шрифт даёт
 * настоящий текст.
 */

const REGULAR_FONT_URL = '/fonts/PTSans-Regular.ttf';
const BOLD_FONT_URL = '/fonts/PTSans-Bold.ttf';
const FONT_NAME = 'PTSans';

const PAGE_MARGIN_PT = 48;
const BODY_SIZE = 10.5;
const H1_SIZE = 19;
const H2_SIZE = 13.5;
const LINE_GAP = 1.35; // множитель к размеру шрифта — межстрочный интервал

type Block =
  | { kind: 'h1' | 'h2' | 'p'; text: string }
  | { kind: 'ul'; items: string[] };

interface Guide {
  blocks: Block[];
}

const GUIDES: Record<'ru' | 'en' | 'fr', Guide> = {
  ru: {
    blocks: [
      { kind: 'h1', text: 'PRIVOX PTT — инструкция для абонента' },
      { kind: 'p', text: 'Рация в вашем телефоне. Ниже — что делать по шагам, от первого сообщения до первого разговора.' },
      { kind: 'h2', text: 'Шаг 1. Откройте код' },
      { kind: 'p', text: 'Вам прислали картинку с квадратным чёрно-белым узором (QR-код) и, возможно, ссылку. Откройте обычное приложение «Камера» на телефоне (специальное приложение для этого не нужно) и наведите на картинку — сверху экрана появится подсказка, нажмите на неё.' },
      { kind: 'p', text: 'Если вместо картинки прислали просто ссылку текстом — нажмите прямо на неё.' },
      { kind: 'h2', text: 'Шаг 2. Нажмите зелёную кнопку' },
      { kind: 'p', text: 'Откроется страница, где будет написано ваше имя и название группы. Нажмите большую зелёную кнопку JOIN THE GROUP. Пароль на этом шаге не нужен.' },
      { kind: 'h2', text: 'Шаг 3. Если предложат установить приложение' },
      { kind: 'p', text: 'На Android: нажмите «Download Android APK», согласитесь на установку, когда телефон спросит, дождитесь окончания установки, затем откройте тот же самый код или ссылку ещё раз и снова нажмите JOIN.' },
      { kind: 'p', text: 'На iPhone: нажмите «Install via TestFlight», далее следуйте двум экранам от Apple (сначала ставится вспомогательное приложение TestFlight, потом само PRIVOX PTT), затем откройте тот же код или ссылку ещё раз и снова нажмите JOIN.' },
      { kind: 'p', text: 'Можно пользоваться и без установки — прямо в браузере, но тогда телефон не «разбудит» вас звонком, если экран выключен.' },
      { kind: 'h2', text: 'Если вместо кода спросят логин и пароль' },
      { kind: 'p', text: 'Введите то, что написано на вашей карточке (Login и Password), и нажмите «Sign in». Буквы и цифры нужно ввести точно как написано, заглавные и строчные буквы различаются.' },
      { kind: 'h2', text: 'Как говорить по рации' },
      { kind: 'p', text: 'Внутри группы: нажмите и удерживайте большую кнопку с микрофоном, говорите, затем отпустите — как в обычной рации. В личном звонке разговор идёт как по обычному телефону, ничего удерживать не нужно.' },
      { kind: 'h2', text: 'Если что-то не получается' },
      {
        kind: 'ul',
        items: [
          'Проверьте громкость телефона.',
          'При первом запуске телефон спросит разрешение на микрофон — обязательно разрешите.',
          'Закройте приложение и откройте его ещё раз один раз после установки.',
          'Обратитесь к тому, кто выдал вам код — он сможет выдать код заново или помочь.',
        ],
      },
    ],
  },
  en: {
    blocks: [
      { kind: 'h1', text: 'PRIVOX PTT — subscriber guide' },
      { kind: 'p', text: 'A radio inside your phone. Below is what to do, step by step, from the first message to your first conversation.' },
      { kind: 'h2', text: 'Step 1. Open the code' },
      { kind: 'p', text: 'You were sent a picture with a black-and-white square pattern (a QR code) and possibly a link. Open the regular Camera app on your phone (no special app needed) and point it at the picture — a banner appears at the top of the screen, tap it.' },
      { kind: 'p', text: 'If you were sent a plain text link instead, just tap it.' },
      { kind: 'h2', text: 'Step 2. Tap the green button' },
      { kind: 'p', text: 'A page opens showing your name and the group name. Tap the large green JOIN THE GROUP button. No password is needed at this step.' },
      { kind: 'h2', text: 'Step 3. If asked to install the app' },
      { kind: 'p', text: 'On Android: tap "Download Android APK", allow the install when your phone asks, wait for it to finish, then open the same code or link once more and tap JOIN again.' },
      { kind: 'p', text: 'On iPhone: tap "Install via TestFlight", follow the two screens from Apple (first a helper app called TestFlight installs, then PRIVOX PTT itself), then open the same code or link once more and tap JOIN again.' },
      { kind: 'p', text: 'You can also use it without installing, right in the browser — but then your phone won’t "wake up" to ring you if the screen is off.' },
      { kind: 'h2', text: 'If asked for a login and password instead' },
      { kind: 'p', text: 'Type exactly what is printed on your card (Login and Password), then tap "Sign in". Letters and numbers must match exactly — uppercase and lowercase are different.' },
      { kind: 'h2', text: 'How to talk on the radio' },
      { kind: 'p', text: 'Inside a group: press and hold the large microphone button, speak, then release — just like a real radio. In a private call, it works like an ordinary phone call — nothing to hold down.' },
      { kind: 'h2', text: 'If something isn’t working' },
      {
        kind: 'ul',
        items: [
          'Check your phone’s volume.',
          'The first time you use it, your phone will ask for microphone permission — allow it.',
          'Close and reopen the app once after installing it.',
          'Ask whoever gave you the code — they can issue a new one or help.',
        ],
      },
    ],
  },
  fr: {
    blocks: [
      { kind: 'h1', text: "PRIVOX PTT — guide de l'abonné" },
      { kind: 'p', text: "Une radio directement dans votre téléphone. Voici, étape par étape, comment faire, du premier message à votre première conversation." },
      { kind: 'h2', text: 'Étape 1. Ouvrez le code' },
      { kind: 'p', text: "On vous a envoyé une image avec un motif carré noir et blanc (un code QR), et parfois un lien. Ouvrez l'application Appareil photo habituelle de votre téléphone (aucune application spéciale n'est nécessaire) et pointez-la vers l'image — une bannière apparaît en haut de l'écran, appuyez dessus." },
      { kind: 'p', text: "Si l'on vous a envoyé un simple lien texte, appuyez directement dessus." },
      { kind: 'h2', text: 'Étape 2. Appuyez sur le bouton vert' },
      { kind: 'p', text: "Une page s'ouvre avec votre nom et le nom du groupe. Appuyez sur le grand bouton vert JOIN THE GROUP. Aucun mot de passe n'est nécessaire à cette étape." },
      { kind: 'h2', text: "Étape 3. Si on vous propose d'installer l'application" },
      { kind: 'p', text: "Sur Android : appuyez sur « Download Android APK », autorisez l'installation lorsque le téléphone le demande, attendez la fin, puis ouvrez à nouveau le même code ou lien et appuyez de nouveau sur JOIN." },
      { kind: 'p', text: "Sur iPhone : appuyez sur « Install via TestFlight », suivez les deux écrans d'Apple (une application intermédiaire appelée TestFlight s'installe d'abord, puis PRIVOX PTT lui-même), puis ouvrez à nouveau le même code ou lien et appuyez de nouveau sur JOIN." },
      { kind: 'p', text: "Vous pouvez aussi l'utiliser sans installation, directement dans le navigateur — mais dans ce cas, votre téléphone ne se « réveillera » pas pour sonner si l'écran est éteint." },
      { kind: 'h2', text: "Si l'on vous demande un identifiant et un mot de passe" },
      { kind: 'p', text: "Saisissez exactement ce qui est inscrit sur votre carte (Login et Password), puis appuyez sur « Sign in ». Les lettres et chiffres doivent correspondre exactement — les majuscules et minuscules sont différentes." },
      { kind: 'h2', text: 'Comment parler à la radio' },
      { kind: 'p', text: "Dans un groupe : appuyez et maintenez le grand bouton microphone, parlez, puis relâchez — comme une vraie radio. Pour un appel privé, cela fonctionne comme un appel téléphonique ordinaire — rien à maintenir." },
      { kind: 'h2', text: 'Si quelque chose ne fonctionne pas' },
      {
        kind: 'ul',
        items: [
          'Vérifiez le volume de votre téléphone.',
          'La première fois, votre téléphone demandera l’autorisation du microphone — acceptez.',
          "Fermez puis rouvrez l'application une fois après l'installation.",
          "Demandez à la personne qui vous a donné le code — elle peut en émettre un nouveau ou vous aider.",
        ],
      },
    ],
  },
};

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

export async function downloadUserGuidePdf(): Promise<void> {
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
  let isFirstPage = true;

  function ensureSpace(nextHeight: number) {
    if (y + nextHeight > pageHeight - PAGE_MARGIN_PT) {
      doc.addPage();
      y = PAGE_MARGIN_PT;
    }
  }

  function paragraph(text: string, size: number, style: 'normal' | 'bold', color: [number, number, number], indent = 0) {
    doc.setFont(FONT_NAME, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, usableWidth - indent) as string[];
    const lineHeight = size * LINE_GAP;
    ensureSpace(lines.length * lineHeight);
    doc.text(lines, PAGE_MARGIN_PT + indent, y + size * 0.9);
    y += lines.length * lineHeight;
  }

  const languages: Array<'ru' | 'en' | 'fr'> = ['ru', 'en', 'fr'];
  languages.forEach((lang, langIndex) => {
    if (!isFirstPage || langIndex > 0) {
      doc.addPage();
      y = PAGE_MARGIN_PT;
    }
    isFirstPage = false;

    for (const block of GUIDES[lang].blocks) {
      if (block.kind === 'h1') {
        y += 4;
        paragraph(block.text, H1_SIZE, 'bold', [10, 12, 10]);
        y += 8;
      } else if (block.kind === 'h2') {
        y += 10;
        paragraph(block.text, H2_SIZE, 'bold', [10, 110, 58]);
        y += 2;
      } else if (block.kind === 'p') {
        paragraph(block.text, BODY_SIZE, 'normal', [20, 20, 20]);
        y += 6;
      } else if (block.kind === 'ul') {
        for (const item of block.items) {
          paragraph(`•  ${item}`, BODY_SIZE, 'normal', [20, 20, 20], 10);
          y += 3;
        }
        y += 4;
      }
    }
  });

  doc.save('privox-ptt-guide-ru-en-fr.pdf');
}
