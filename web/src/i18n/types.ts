// D58 — переключатель языка публичного сайта (Home/Download/Docs/FAQ/Support/
// Privacy/Status). Свой лёгкий словарь вместо react-i18next: три статических
// языка, без плюрализации/ICU — обычный объект с текстом на каждом языке
// сильно проще и не тянет лишнюю зависимость.
//
// Иконки НЕ переводятся и живут отдельно от текста (см. PublicPages.tsx,
// массивы вида AUDIENCE_ICONS) — сюда попадают только строки, порядок
// массивов должен совпадать между тремя языками и соответствующим массивом
// иконок по индексу.

export interface DocSection {
  title: string;
  text: string;
  steps?: string[];
  items?: string[];
}

export interface SiteContent {
  nav: {
    download: string;
    overview: string;
    forBusiness: string;
    docs: string;
    faq: string;
    support: string;
    status: string;
    signIn: string;
    openApp: string;
    logOut: string;
  };
  footer: {
    tagline: string;
    signIn: string;
    download: string;
    docs: string;
    faq: string;
    support: string;
    privacy: string;
    overviewLabel: string;
    businessLabel: string;
  };
  home: {
    heroBadge: string;
    heroSubtitle: string;
    signInCta: string;
    downloadCta: string;
    docsCta: string;
    guideCta: string;
    guideCtaWorking: string;
    mockupCaption: string;
    mockupChannels: string[]; // 'Priority channel', 'Field team', 'Operations channel'
    mockupPushToTalk: string;
    mockupFooter: string[]; // 'Team online', 'WebRTC', 'Secure auth'
    whatItIs: { eyebrow: string; title: string; text: string; items: string[] };
    audience: { eyebrow: string; title: string; items: string[] };
    howItWorks: { eyebrow: string; title: string; items: string[] };
    capabilities: { eyebrow: string; title: string; items: string[] };
    platforms: { eyebrow: string; title: string; items: { title: string; status: string }[] };
    help: { eyebrow: string; title: string; docs: string; faq: string; support: string };
  };
  download: {
    eyebrow: string;
    title: string;
    text: string;
    android: { title: string; badge: string; text: string; cta: string };
    t320: { title: string; badge: string; text: string; version: string; cta: string; setupGuide: string };
    iphone: { title: string; badgeTestflight: string; badgeWeb: string; textTestflight: string; textWeb: string; ctaTestflight: string; ctaWeb: string; setupGuide: string };
    mini: { title: string; badge: string; setupGuide: string };
    signInWays: {
      title: string;
      qrTitle: string;
      qrText: string;
      passwordTitle: string;
      passwordTextBefore: string;
      passwordLink: string;
      passwordTextAfter: string;
    };
    guide: { title: string; text: string };
    upgradeWarning: { title: string; text1: string; text2: string };
    webVersion: {
      title: string;
      text: string;
      cta: string;
      addHomeScreenTitle: string;
      addHomeScreenSteps: string[];
      computerTitle: string;
      computerText: string;
    };
    androidSteps: { title: string; steps: string[]; webviewWarning: string; footnote: string };
    iosSteps: { title: string; text: string; steps: string[]; cta: string; footnote: string };
    checklist: { title: string; items: string[] };
    troubleshoot: { title: string; items: string[] };
  };
  docs: {
    eyebrow: string;
    title: string;
    text: string;
    sectionLabel: string; // "Section"
    open: string;
    close: string;
    sections: DocSection[];
    scenario: { title: string; steps: string[] };
  };
  faq: {
    eyebrow: string;
    title: string;
    open: string;
    close: string;
    items: [string, string][];
  };
  support: {
    eyebrow: string;
    title: string;
    text: string;
    columns: { title: string; items: string[] }[];
    form: {
      title: string;
      text: string;
      name: string;
      namePlaceholder: string;
      email: string;
      emailPlaceholder: string;
      message: string;
      messagePlaceholder: string;
      submit: string;
      sent: string;
    };
  };
  privacy: {
    eyebrow: string;
    title: string;
    text: string;
    lastUpdated: string;
    sections: { title: string; text?: string; blocks?: { title: string; text: string }[]; items?: string[] }[];
    contactBefore: string;
    contactLink: string;
    contactAfter: string;
  };
  status: {
    eyebrow: string;
    title: string;
    text: string;
    checking: string;
    operational: string;
    needsAttention: string;
    detailsOk: string;
    detailsError: string;
    detailsUnreachable: string;
  };
}

export type LanguageCode = 'en' | 'ru' | 'fr';
