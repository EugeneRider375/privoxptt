/**
 * Печатная инструкция для абонента — RU/EN/FR, одним файлом, скачивается
 * с публичной страницы /download (не привязана к конкретному человеку,
 * в отличие от inviteCard.ts/invitePdf.ts).
 *
 * Встроенные шрифты jsPDF знают только Latin-1 — кириллица и французские
 * диакритики просто не отрисуются. Вместо ручной embed-шрифтов используем
 * штатный doc.html() (внутри — html2canvas, уже есть в зависимостях из-за
 * jsPDF): страница рисуется браузером как обычный HTML, значит любой язык
 * рендерится тем же способом, что и весь остальной сайт.
 */

const CONTENT_WIDTH_PT = 515; // A4 (595pt) минус поля по 40pt с каждой стороны
const RENDER_WIDTH_PX = 760; // ширина off-screen контейнера для html2canvas

function section(lang: 'ru' | 'en' | 'fr', firstPage: boolean): string {
  const pageBreak = firstPage ? '' : 'page-break-before: always;';
  const content: Record<'ru' | 'en' | 'fr', string> = {
    ru: `
      <h1>PRIVOX PTT — инструкция для абонента</h1>
      <p class="lead">Рация в вашем телефоне. Ниже — что делать по шагам, от первого сообщения до первого разговора.</p>

      <h2>Шаг 1. Откройте код</h2>
      <p>Вам прислали картинку с квадратным чёрно-белым узором (QR-код) и, возможно, ссылку. Откройте обычное приложение «Камера» на телефоне (специальное приложение для этого не нужно) и наведите на картинку — сверху экрана появится подсказка, нажмите на неё.</p>
      <p>Если вместо картинки прислали просто ссылку текстом — нажмите прямо на неё.</p>

      <h2>Шаг 2. Нажмите зелёную кнопку</h2>
      <p>Откроется страница, где будет написано ваше имя и название группы. Нажмите большую зелёную кнопку <b>JOIN THE GROUP</b>. Пароль на этом шаге не нужен.</p>

      <h2>Шаг 3. Если предложат установить приложение</h2>
      <p><b>На Android:</b> нажмите «Download Android APK», согласитесь на установку, когда телефон спросит, дождитесь окончания установки, затем откройте тот же самый код или ссылку ещё раз и снова нажмите JOIN.</p>
      <p><b>На iPhone:</b> нажмите «Install via TestFlight», далее следуйте двум экранам от Apple (сначала ставится вспомогательное приложение TestFlight, потом само PRIVOX PTT), затем откройте тот же код или ссылку ещё раз и снова нажмите JOIN.</p>
      <p>Можно пользоваться и без установки — прямо в браузере, но тогда телефон не «разбудит» вас звонком, если экран выключен.</p>

      <h2>Если вместо кода спросят логин и пароль</h2>
      <p>Введите то, что написано на вашей карточке (Login и Password), и нажмите «Sign in». Буквы и цифры нужно ввести точно как написано, заглавные и строчные буквы различаются.</p>

      <h2>Как говорить по рации</h2>
      <p>Внутри группы: нажмите и удерживайте большую кнопку с микрофоном, говорите, затем отпустите — как в обычной рации. В личном звонке разговор идёт как по обычному телефону, ничего удерживать не нужно.</p>

      <h2>Если что-то не получается</h2>
      <ul>
        <li>Проверьте громкость телефона.</li>
        <li>При первом запуске телефон спросит разрешение на микрофон — обязательно разрешите.</li>
        <li>Закройте приложение и откройте его ещё раз один раз после установки.</li>
        <li>Обратитесь к тому, кто выдал вам код — он сможет выдать код заново или помочь.</li>
      </ul>
    `,
    en: `
      <h1>PRIVOX PTT — subscriber guide</h1>
      <p class="lead">A radio inside your phone. Below is what to do, step by step, from the first message to your first conversation.</p>

      <h2>Step 1. Open the code</h2>
      <p>You were sent a picture with a black-and-white square pattern (a QR code) and possibly a link. Open the regular Camera app on your phone (no special app needed) and point it at the picture — a banner appears at the top of the screen, tap it.</p>
      <p>If you were sent a plain text link instead, just tap it.</p>

      <h2>Step 2. Tap the green button</h2>
      <p>A page opens showing your name and the group name. Tap the large green <b>JOIN THE GROUP</b> button. No password is needed at this step.</p>

      <h2>Step 3. If asked to install the app</h2>
      <p><b>On Android:</b> tap "Download Android APK", allow the install when your phone asks, wait for it to finish, then open the same code or link once more and tap JOIN again.</p>
      <p><b>On iPhone:</b> tap "Install via TestFlight", follow the two screens from Apple (first a helper app called TestFlight installs, then PRIVOX PTT itself), then open the same code or link once more and tap JOIN again.</p>
      <p>You can also use it without installing, right in the browser — but then your phone won't "wake up" to ring you if the screen is off.</p>

      <h2>If asked for a login and password instead</h2>
      <p>Type exactly what is printed on your card (Login and Password), then tap "Sign in". Letters and numbers must match exactly — uppercase and lowercase are different.</p>

      <h2>How to talk on the radio</h2>
      <p>Inside a group: press and hold the large microphone button, speak, then release — just like a real radio. In a private call, it works like an ordinary phone call — nothing to hold down.</p>

      <h2>If something isn't working</h2>
      <ul>
        <li>Check your phone's volume.</li>
        <li>The first time you use it, your phone will ask for microphone permission — allow it.</li>
        <li>Close and reopen the app once after installing it.</li>
        <li>Ask whoever gave you the code — they can issue a new one or help.</li>
      </ul>
    `,
    fr: `
      <h1>PRIVOX PTT — guide de l'abonné</h1>
      <p class="lead">Une radio directement dans votre téléphone. Voici, étape par étape, comment faire, du premier message à votre première conversation.</p>

      <h2>Étape 1. Ouvrez le code</h2>
      <p>On vous a envoyé une image avec un motif carré noir et blanc (un code QR), et parfois un lien. Ouvrez l'application Appareil photo habituelle de votre téléphone (aucune application spéciale n'est nécessaire) et pointez-la vers l'image — une bannière apparaît en haut de l'écran, appuyez dessus.</p>
      <p>Si l'on vous a envoyé un simple lien texte, appuyez directement dessus.</p>

      <h2>Étape 2. Appuyez sur le bouton vert</h2>
      <p>Une page s'ouvre avec votre nom et le nom du groupe. Appuyez sur le grand bouton vert <b>JOIN THE GROUP</b>. Aucun mot de passe n'est nécessaire à cette étape.</p>

      <h2>Étape 3. Si on vous propose d'installer l'application</h2>
      <p><b>Sur Android :</b> appuyez sur « Download Android APK », autorisez l'installation lorsque le téléphone le demande, attendez la fin, puis ouvrez à nouveau le même code ou lien et appuyez de nouveau sur JOIN.</p>
      <p><b>Sur iPhone :</b> appuyez sur « Install via TestFlight », suivez les deux écrans d'Apple (une application intermédiaire appelée TestFlight s'installe d'abord, puis PRIVOX PTT lui-même), puis ouvrez à nouveau le même code ou lien et appuyez de nouveau sur JOIN.</p>
      <p>Vous pouvez aussi l'utiliser sans installation, directement dans le navigateur — mais dans ce cas, votre téléphone ne se « réveillera » pas pour sonner si l'écran est éteint.</p>

      <h2>Si l'on vous demande un identifiant et un mot de passe</h2>
      <p>Saisissez exactement ce qui est inscrit sur votre carte (Login et Password), puis appuyez sur « Sign in ». Les lettres et chiffres doivent correspondre exactement — les majuscules et minuscules sont différentes.</p>

      <h2>Comment parler à la radio</h2>
      <p>Dans un groupe : appuyez et maintenez le grand bouton microphone, parlez, puis relâchez — comme une vraie radio. Pour un appel privé, cela fonctionne comme un appel téléphonique ordinaire — rien à maintenir.</p>

      <h2>Si quelque chose ne fonctionne pas</h2>
      <ul>
        <li>Vérifiez le volume de votre téléphone.</li>
        <li>La première fois, votre téléphone demandera l'autorisation du microphone — acceptez.</li>
        <li>Fermez puis rouvrez l'application une fois après l'installation.</li>
        <li>Demandez à la personne qui vous a donné le code — elle peut en émettre un nouveau ou vous aider.</li>
      </ul>
    `,
  };
  return `<div style="${pageBreak} font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color:#111; padding-top:${firstPage ? '0' : '4px'}">${content[lang]}</div>`;
}

function buildGuideHtml(): string {
  return `
    <style>
      h1 { font-size: 22px; margin: 0 0 6px; }
      h2 { font-size: 15px; margin: 18px 0 6px; color: #0A6E3A; }
      p, li { font-size: 12px; line-height: 1.5; margin: 4px 0; }
      p.lead { color: #555; font-style: italic; }
      ul { margin: 4px 0; padding-left: 18px; }
      b { color: #000; }
    </style>
    ${section('ru', true)}
    ${section('en', false)}
    ${section('fr', false)}
  `;
}

export async function downloadUserGuidePdf(): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const container = document.createElement('div');
  container.innerHTML = buildGuideHtml();
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${RENDER_WIDTH_PX}px`;
  document.body.appendChild(container);

  try {
    await new Promise<void>((resolve, reject) => {
      doc.html(container, {
        x: 40,
        y: 30,
        width: CONTENT_WIDTH_PT,
        windowWidth: RENDER_WIDTH_PX,
        autoPaging: 'text',
        callback: () => resolve(),
        // На случай, если сам рендер выбросит исключение синхронно.
        html2canvas: { logging: false },
      });
    }).catch((err) => {
      throw err instanceof Error ? err : new Error(String(err));
    });
    doc.save('privox-ptt-guide-ru-en-fr.pdf');
  } finally {
    document.body.removeChild(container);
  }
}
