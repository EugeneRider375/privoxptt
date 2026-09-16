import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  FileQuestion,
  FileText,
  Globe,
  Headphones,
  Lock,
  MapPinned,
  MessageCircle,
  Mic,
  Radio,
  Router,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { authApi } from '@/api/client';
import { unregisterNativePushDevice } from '@/hooks/useNativePush';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';
import { disconnectPrivoxSocket } from '@/hooks/useSocket';
import { useStore } from '@/store/useStore';
import { downloadUserGuidePdf } from '@/utils/userGuidePdf';
import { LanguageProvider, useLanguage } from '@/i18n/context';
import type { LanguageCode } from '@/i18n/types';

// Иконки не переводятся — привязаны к текстовым массивам из словаря (t.home.*)
// по индексу, порядок должен совпадать между en/ru/fr (см. i18n/types.ts).
const AUDIENCE_ICONS = [ShieldCheck, Headphones, MapPinned, Cloud, Wifi, Building2, Wrench, Users];
const HOW_IT_WORKS_ICONS = [Smartphone, Router, Users, Radio];
const CAPABILITY_ICONS = [Mic, Users, Headphones, TerminalSquare, Cloud, Smartphone, Radio, Wifi, Lock];
const PLATFORM_ICONS = [Cloud, Smartphone, Radio, Radio, BadgeCheck];
const PLATFORM_TONES = [
  'text-sky-700 bg-sky-50 border-sky-100',
  'text-emerald-700 bg-emerald-50 border-emerald-100',
  'text-orange-700 bg-orange-50 border-orange-100',
  'text-indigo-700 bg-indigo-50 border-indigo-100',
  'text-slate-700 bg-slate-50 border-slate-200',
];

const LANGUAGE_LABELS: Record<LanguageCode, string> = { en: 'EN', ru: 'RU', fr: 'FR' };

function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold text-slate-500', className)}>
      <Globe className="h-3.5 w-3.5" />
      {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map((code, i) => (
        <span key={code} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">·</span>}
          <button
            onClick={() => setLang(code)}
            className={clsx('hover:text-sky-700', lang === code ? 'text-sky-700' : 'text-slate-500')}
          >
            {LANGUAGE_LABELS[code]}
          </button>
        </span>
      ))}
    </span>
  );
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = useStore((s) => s.user);
  const clearAuth = useStore((s) => s.clearAuth);
  const { t } = useLanguage();

  const navLinks = [
    { to: '/download', label: t.nav.download },
    // Презентация системы — отдельная статическая страница (web/public/presentation),
    // а не маршрут приложения, и не часть этого переключателя (у неё свой,
    // независимый RU/EN/FR — см. langs ниже). Поэтому external: обычная
    // ссылка, не Link роутера.
    {
      to: '/presentation/', label: t.nav.overview, external: true,
      langs: [
        { to: '/presentation/', label: 'RU' },
        { to: '/presentation/en/', label: 'EN' },
        { to: '/presentation/fr/', label: 'FR' },
      ],
    },
    {
      to: '/business/', label: t.nav.forBusiness, external: true,
      langs: [
        { to: '/business/', label: 'RU' },
        { to: '/business/en/', label: 'EN' },
      ],
    },
    { to: '/docs', label: t.nav.docs },
    { to: '/faq', label: t.nav.faq },
    { to: '/support', label: t.nav.support },
    { to: '/status', label: t.nav.status },
  ];

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken') ?? '';
    await unregisterNativePushDevice().catch(() => {});
    await authApi.logout(refreshToken).catch(() => {});
    disconnectPrivoxSocket();
    clearAuth();
  }

  return (
    <div className="h-full overflow-y-auto bg-white text-slate-950 font-sans">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-950">
            <PrivoxLogo className="h-9 w-9 shadow-sm" markClassName="h-6 w-6" />
            <span className="text-lg">PRIVOX PTT</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {navLinks.map((link) =>
              link.external ? (
                <span key={link.to} className="inline-flex items-center gap-1.5">
                  <a href={link.to} className="hover:text-sky-700">
                    {link.label}
                  </a>
                  {'langs' in link && link.langs && (
                    <span className="flex items-center gap-1 text-xs font-normal text-slate-400">
                      {link.langs.map((lng, i) => (
                        <span key={lng.to} className="flex items-center gap-1">
                          {i > 0 && <span>·</span>}
                          <a href={lng.to} className="hover:text-sky-700">{lng.label}</a>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              ) : (
                <Link key={link.to} to={link.to} className="hover:text-sky-700">
                  {link.label}
                </Link>
              )
            )}
            <LanguageSwitcher />
          </nav>
          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={handleLogout}
                className="hidden rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700 sm:inline-flex"
              >
                {t.nav.logOut}
              </button>
            )}
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
            >
              {user ? t.nav.openApp : t.nav.signIn} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="font-bold text-slate-950">PRIVOX PTT</p>
            <p className="mt-1 text-sm text-slate-500">{t.footer.tagline}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-600">
            <Link to="/app" className="hover:text-sky-700">{t.footer.signIn}</Link>
            <Link to="/download" className="hover:text-sky-700">{t.footer.download}</Link>
            <Link to="/docs" className="hover:text-sky-700">{t.footer.docs}</Link>
            <Link to="/faq" className="hover:text-sky-700">{t.footer.faq}</Link>
            <Link to="/support" className="hover:text-sky-700">{t.footer.support}</Link>
            <Link to="/privacy" className="hover:text-sky-700">{t.footer.privacy}</Link>
            {/* Верхнее меню (nav выше) скрыто на мобильных — footer нет,
                поэтому презентация продублирована сюда на всех трёх языках
                (замечено Eugene: без этого её легко потерять), плюс сам
                переключатель языка сайта. */}
            <span className="text-slate-400">·</span>
            <a href="/presentation/" className="hover:text-sky-700">{t.footer.overviewLabel} (RU)</a>
            <a href="/presentation/en/" className="hover:text-sky-700">EN</a>
            <a href="/presentation/fr/" className="hover:text-sky-700">FR</a>
            <span className="text-slate-400">·</span>
            <a href="/business/" className="hover:text-sky-700">{t.footer.businessLabel} (RU)</a>
            <a href="/business/en/" className="hover:text-sky-700">EN</a>
            <span className="text-slate-400">·</span>
            <LanguageSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-lg leading-8 text-slate-600">{text}</p>}
    </div>
  );
}

function AppMockup() {
  const { t } = useLanguage();
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-2xl shadow-sky-900/10">
      <div className="rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm font-semibold">ONLINE</span>
          </div>
          <span className="rounded bg-sky-500/15 px-2 py-1 text-xs text-sky-200">DISPATCH</span>
        </div>
        <div className="grid gap-3 py-4 sm:grid-cols-[1fr_150px]">
          <div className="space-y-2">
            {t.home.mockupChannels.map((name, index) => (
              <div key={name} className={clsx('rounded-md border p-3', index === 1 ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10 bg-white/5')}>
                <div className="flex items-center gap-2">
                  <span className={clsx('h-2 w-2 rounded-full', index === 0 ? 'bg-red-400' : index === 1 ? 'bg-emerald-400' : 'bg-sky-400')} />
                  <span className="text-sm font-semibold">{name}</span>
                  {index === 1 && <Mic className="ml-auto h-4 w-4 text-emerald-300" />}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-white/5 p-4">
            <PrivoxLogo className="h-24 w-24 rounded-2xl shadow-lg shadow-emerald-400/20" markClassName="h-16 w-16" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">{t.home.mockupPushToTalk}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-xs text-slate-300">
          {t.home.mockupFooter.map((label) => <span key={label}>{label}</span>)}
        </div>
      </div>
      <p className="mt-3 px-1 text-xs text-slate-500">{t.home.mockupCaption}</p>
    </div>
  );
}

function HomePageInner() {
  const { t } = useLanguage();
  return (
    <PublicLayout>
      <main>
        <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-slate-100">
          <div className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1 text-sm font-medium text-sky-800 shadow-sm">
                <ShieldCheck className="h-4 w-4" />
                {t.home.heroBadge}
              </div>
              <h1 className="mt-6 text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                PRIVOX PTT
              </h1>
              <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">
                {t.home.heroSubtitle}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/app" className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
                  {t.home.signInCta} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/download" className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm transition hover:border-sky-300 hover:text-sky-700">
                  {t.home.downloadCta} <Download className="h-4 w-4" />
                </Link>
                <Link to="/docs" className="inline-flex items-center justify-center gap-2 rounded-md border border-transparent px-5 py-3 font-semibold text-slate-700 transition hover:text-sky-700">
                  {t.home.docsCta} <BookOpen className="h-4 w-4" />
                </Link>
                <HeroGuideDownloadButton />
              </div>
            </div>
            <AppMockup />
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow={t.home.whatItIs.eyebrow}
            title={t.home.whatItIs.title}
            text={t.home.whatItIs.text}
          />
          <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.home.whatItIs.items.map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <CheckCircle2 className="h-5 w-5 text-sky-600" />
                <p className="mt-3 font-semibold text-slate-900">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader eyebrow={t.home.audience.eyebrow} title={t.home.audience.title} />
          <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.home.audience.items.map((title, i) => {
              const Icon = AUDIENCE_ICONS[i];
              return (
                <div key={title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <Icon className="h-6 w-6 text-sky-600" />
                  <p className="mt-4 font-semibold text-slate-900">{title}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader eyebrow={t.home.howItWorks.eyebrow} title={t.home.howItWorks.title} />
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 lg:grid-cols-4">
            {t.home.howItWorks.items.map((title, index) => {
              const Icon = HOW_IT_WORKS_ICONS[index];
              return (
                <div key={title} className="relative rounded-lg border border-slate-200 bg-slate-50 p-6">
                  <Icon className="h-7 w-7 text-sky-600" />
                  <p className="mt-4 font-semibold text-slate-900">{title}</p>
                  {index < 3 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-slate-300 lg:block" />}
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader eyebrow={t.home.capabilities.eyebrow} title={t.home.capabilities.title} />
          <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.home.capabilities.items.map((title, i) => {
              const Icon = CAPABILITY_ICONS[i];
              return (
                <div key={title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <Icon className="h-6 w-6 text-sky-600" />
                  <p className="mt-3 font-semibold text-slate-900">{title}</p>
                </div>
              );
            })}
          </div>
        </section>

        <PlatformsSection />
        <HelpSection />
      </main>
    </PublicLayout>
  );
}

function PlatformsSection() {
  const { t } = useLanguage();
  return (
    <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
      <SectionHeader eyebrow={t.home.platforms.eyebrow} title={t.home.platforms.title} />
      <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {t.home.platforms.items.map(({ title, status }, i) => {
          const Icon = PLATFORM_ICONS[i];
          return (
            <div key={title} className={clsx('rounded-lg border p-5', PLATFORM_TONES[i])}>
              <Icon className="h-7 w-7" />
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm">{status}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HelpSection() {
  const { t } = useLanguage();
  return (
    <section className="bg-slate-950 px-4 py-16 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1fr_1.2fr] md:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">{t.home.help.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">{t.home.help.title}</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['/docs', t.home.help.docs, BookOpen],
            ['/faq', t.home.help.faq, FileQuestion],
            ['/support', t.home.help.support, MessageCircle],
          ].map(([to, label, Icon]) => (
            <Link key={to as string} to={to as string} className="rounded-lg border border-white/10 bg-white/5 p-5 transition hover:bg-white/10">
              <Icon className="h-6 w-6 text-sky-300" />
              <p className="mt-4 font-semibold">{label as string}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Общее для всех мест, откуда можно скачать PDF-гайд — сама генерация не
 * меняется, меняется только то, как это выглядит на странице. */
function useGuideDownload() {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');

  async function handleClick() {
    setState('working');
    try {
      await downloadUserGuidePdf();
      setState('idle');
    } catch (err) {
      console.error('[Guide PDF] Failed to generate:', err);
      setState('error');
    }
  }

  return { state, handleClick };
}

function GuideDownloadButton() {
  const { state, handleClick } = useGuideDownload();
  const { t } = useLanguage();

  return (
    <div className="mt-5">
      <button
        onClick={handleClick}
        disabled={state === 'working'}
        className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {state === 'working' ? t.home.guideCtaWorking : t.home.guideCta} <Download className="h-4 w-4" />
      </button>
      {state === 'error' && (
        <p className="mt-3 text-sm text-red-600">Could not generate the PDF. Try again, or use a different browser.</p>
      )}
    </div>
  );
}

/** Компактная версия для ряда кнопок в шапке главной страницы — тот же
 * хук/генерация, что и GuideDownloadButton, просто вписана в общий ряд. */
function HeroGuideDownloadButton() {
  const { state, handleClick } = useGuideDownload();
  const { t } = useLanguage();

  return (
    <button
      onClick={handleClick}
      disabled={state === 'working'}
      className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-60"
    >
      {state === 'working' ? t.home.guideCtaWorking : t.home.guideCta} <FileText className="h-4 w-4" />
    </button>
  );
}

function DownloadPageInner() {
  const { t } = useLanguage();
  // Сборки подписаны рабочим ключом PRIVOX — обновляются поверх предыдущих.
  // ?v= обязателен и должен расти с каждой сборкой: без него Cloudflare и
  // браузер отдадут закешированный APK со старым содержимым.
  const androidApkUrl = '/downloads/privox-ptt-android.apk?v=14';
  const t320ApkUrl = '/downloads/privox-ptt-t320.apk?v=13';
  const webAppUrl = '/app';
  // Публичная ссылка TestFlight — см. D23 в BACKLOG_RU.md. Если когда-нибудь
  // понадобится сменить (например, при переходе на полную публикацию в App
  // Store) — обновить и здесь, и в JoinPage.tsx (IOS_TESTFLIGHT_URL).
  const iosTestFlightUrl = 'https://testflight.apple.com/join/zRVpz5WR';
  const d = t.download;

  return (
    <PublicLayout>
      <main className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={d.eyebrow} title={d.title} text={d.text} />
        <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
            <Smartphone className="h-8 w-8 text-emerald-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">{d.android.title}</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-emerald-700">{d.android.badge}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{d.android.text}</p>
            <a href={androidApkUrl} download className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700">
              {d.android.cta} <Download className="h-4 w-4" />
            </a>
          </div>
          <div className="rounded-lg border border-orange-200 bg-white p-6 shadow-sm">
            <Radio className="h-8 w-8 text-orange-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">{d.t320.title}</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-orange-700">{d.t320.badge}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{d.t320.text}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{d.t320.version}</p>
            <a href={t320ApkUrl} download className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700">
              {d.t320.cta} <Download className="h-4 w-4" />
            </a>
            <Link to="/docs" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-orange-300 px-4 py-3 font-semibold text-orange-700 transition hover:bg-orange-50">
              {d.t320.setupGuide} <BookOpen className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-lg border border-sky-200 bg-white p-6 shadow-sm">
            <BadgeCheck className="h-8 w-8 text-sky-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">{d.iphone.title}</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-sky-700">
              {iosTestFlightUrl ? d.iphone.badgeTestflight : d.iphone.badgeWeb}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {iosTestFlightUrl ? d.iphone.textTestflight : d.iphone.textWeb}
            </p>
            {iosTestFlightUrl ? (
              <a href={iosTestFlightUrl} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
                {d.iphone.ctaTestflight} <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <a href={webAppUrl} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
                {d.iphone.ctaWeb} <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <Link to="/docs" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-sky-200 bg-white px-4 py-3 font-semibold text-sky-700 transition hover:bg-sky-50">
              {d.iphone.setupGuide} <BookOpen className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-white p-6 shadow-sm">
            <Radio className="h-8 w-8 text-indigo-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">{d.mini.title}</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-indigo-700">{d.mini.badge}</p>
            <Link to="/docs" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-indigo-700">
              {d.mini.setupGuide} <BookOpen className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">{d.signInWays.title}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-950">{d.signInWays.qrTitle}</p>
              <p className="mt-2">{d.signInWays.qrText}</p>
            </div>
            <div className="rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-950">{d.signInWays.passwordTitle}</p>
              <p className="mt-2">
                {d.signInWays.passwordTextBefore}{' '}
                <Link to="/login" className="font-semibold text-sky-700 hover:underline">{d.signInWays.passwordLink}</Link>{' '}
                {d.signInWays.passwordTextAfter}
              </p>
            </div>
          </div>
        </section>
        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">{d.guide.title}</h2>
          <p className="mt-3 leading-7 text-slate-600">{d.guide.text}</p>
          <GuideDownloadButton />
        </section>
        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-slate-950">{d.upgradeWarning.title}</h2>
          <p className="mt-3 leading-7 text-slate-700">{d.upgradeWarning.text1}</p>
          <p className="mt-2 leading-7 text-slate-700">{d.upgradeWarning.text2}</p>
        </section>

        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-sky-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">{d.webVersion.title}</h2>
          <p className="mt-3 leading-7 text-slate-600">{d.webVersion.text}</p>
          <a href={webAppUrl} className="mt-5 inline-flex items-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
            {d.webVersion.cta} <ArrowRight className="h-4 w-4" />
          </a>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-950">{d.webVersion.addHomeScreenTitle}</p>
              <ol className="mt-2 space-y-1">
                {d.webVersion.addHomeScreenSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
            <div className="rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-950">{d.webVersion.computerTitle}</p>
              <p className="mt-2">{d.webVersion.computerText}</p>
            </div>
          </div>
        </section>
        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">{d.androidSteps.title}</h2>
          <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-600 md:grid-cols-2">
            {d.androidSteps.steps.map((step, i) => (
              <li key={step} className="rounded-md bg-slate-50 p-4"><span className="font-semibold text-slate-950">{i + 1}.</span> {step}</li>
            ))}
          </ol>
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            {d.androidSteps.webviewWarning}
          </div>
          <p className="mt-4 text-xs text-slate-500">{d.androidSteps.footnote}</p>
        </section>
        {iosTestFlightUrl && (
          <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-sky-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">{d.iosSteps.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{d.iosSteps.text}</p>
            <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-600 md:grid-cols-2">
              {d.iosSteps.steps.map((step, i) => (
                <li key={step} className="rounded-md bg-slate-50 p-4"><span className="font-semibold text-slate-950">{i + 1}.</span> {step}</li>
              ))}
            </ol>
            <a href={iosTestFlightUrl} className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
              {d.iosSteps.cta} <ExternalLink className="h-4 w-4" />
            </a>
            <p className="mt-4 text-xs text-slate-500">{d.iosSteps.footnote}</p>
          </section>
        )}
        <section className="mx-auto mt-8 grid max-w-5xl gap-5 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">{d.checklist.title}</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
              {d.checklist.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">{d.troubleshoot.title}</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
              {d.troubleshoot.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </PublicLayout>
  );
}

function DocsPageInner() {
  const { t } = useLanguage();
  const d = t.docs;
  return (
    <PublicLayout>
      <main className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={d.eyebrow} title={d.title} text={d.text} />
        <div className="mx-auto mt-10 max-w-5xl space-y-4">
          {d.sections.map((section, index) => (
            <details key={section.title} className="group rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-sky-700">{d.sectionLabel} {index + 1}</p>
                    <h2 className="mt-2 text-xl font-bold text-slate-950">{section.title}</h2>
                  </div>
                  <span className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 group-open:text-sky-700">
                    <span className="group-open:hidden">{d.open}</span>
                    <span className="hidden group-open:inline">{d.close}</span>
                  </span>
                </div>
              </summary>
              <div className="mt-4 border-t border-slate-200 pt-4">
                <p className="leading-7 text-slate-600">{section.text}</p>
                {section.steps && (
                  <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                    {section.steps.map((step, i) => (
                      <li key={step} className="flex gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {section.items && (
                  <ul className={clsx('space-y-2 text-sm leading-6 text-slate-600', section.steps ? 'mt-4 border-t border-slate-100 pt-4' : 'mt-4')}>
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          ))}
        </div>
        <section className="mx-auto mt-10 max-w-6xl rounded-lg border border-sky-200 bg-sky-50 p-6">
          <h2 className="text-xl font-bold text-slate-950">{d.scenario.title}</h2>
          <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
            {d.scenario.steps.map((step, index) => (
              <li key={step} className="rounded-md bg-white p-4 shadow-sm">
                <span className="font-semibold text-slate-950">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </PublicLayout>
  );
}

function FaqPageInner() {
  const { t } = useLanguage();
  return (
    <PublicLayout>
      <main className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={t.faq.eyebrow} title={t.faq.title} />
        <div className="mx-auto mt-10 max-w-4xl space-y-4">
          {t.faq.items.map(([question, answer]) => (
            <details key={question} className="group rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-lg font-bold text-slate-950">{question}</h2>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500 group-open:text-sky-700">
                    <span className="group-open:hidden">{t.faq.open}</span>
                    <span className="hidden group-open:inline">{t.faq.close}</span>
                  </span>
                </div>
              </summary>
              <p className="mt-3 border-t border-slate-100 pt-3 leading-7 text-slate-600">{answer}</p>
            </details>
          ))}
        </div>
      </main>
    </PublicLayout>
  );
}

function SupportPageInner() {
  const [sent, setSent] = useState(false);
  const { t } = useLanguage();
  const s = t.support;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }

  return (
    <PublicLayout>
      <main className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={s.eyebrow} title={s.title} text={s.text} />
        <section className="mx-auto mt-10 grid max-w-6xl gap-5 md:grid-cols-3">
          {s.columns.map(({ title, items }) => (
            <article key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">{title}</h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                {items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
        <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-2xl rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">{s.form.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{s.form.text}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              {s.form.name}
              <input className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder={s.form.namePlaceholder} />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {s.form.email}
              <input type="email" className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder={s.form.emailPlaceholder} />
            </label>
          </div>
          <label className="mt-4 block text-sm font-semibold text-slate-700">
            {s.form.message}
            <textarea className="mt-2 min-h-36 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder={s.form.messagePlaceholder} />
          </label>
          <button className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
            {s.form.submit} <ArrowRight className="h-4 w-4" />
          </button>
          {sent && <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{s.form.sent}</p>}
        </form>
      </main>
    </PublicLayout>
  );
}

function PrivacyPageInner() {
  const { t } = useLanguage();
  const p = t.privacy;
  return (
    <PublicLayout>
      <main className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={p.eyebrow} title={p.title} text={p.text} />
        <div className="mx-auto mt-10 max-w-3xl space-y-10 text-slate-700">
          <p className="text-sm text-slate-500">{p.lastUpdated}</p>

          {p.sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-bold text-slate-950">{section.title}</h2>
              {section.text !== undefined && section.text !== '' && (
                <p className="mt-3 leading-7">{section.text}</p>
              )}
              {section.blocks && (
                <div className="mt-4 space-y-4">
                  {section.blocks.map((block) => (
                    <div key={block.title} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                      <p className="font-semibold text-slate-950">{block.title}</p>
                      <p className="mt-1 text-sm leading-6">{block.text}</p>
                    </div>
                  ))}
                </div>
              )}
              {section.items && (
                <ul className="mt-3 space-y-2 text-sm leading-6">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      {section.title === p.sections[2]?.title
                        ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />}
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Последний раздел ("Questions or requests") — единственный со
                  ссылкой на /support внутри текста, поэтому рендерится отдельно. */}
              {section.title === p.sections[p.sections.length - 1]?.title && (
                <p className="mt-3 leading-7">
                  {p.contactBefore}{' '}
                  <Link to="/support" className="font-semibold text-sky-700 hover:underline">{p.contactLink}</Link>
                  {p.contactAfter}
                </p>
              )}
            </section>
          ))}
        </div>
      </main>
    </PublicLayout>
  );
}

function StatusPageInner() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const { t } = useLanguage();
  const st = t.status;
  const [details, setDetails] = useState<string>(st.checking);

  useEffect(() => {
    fetch('/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setStatus(data?.status === 'ok' ? 'ok' : 'error');
        setDetails(data?.status === 'ok' ? st.detailsOk : st.detailsError);
      })
      .catch(() => {
        setStatus('error');
        setDetails(st.detailsUnreachable);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PublicLayout>
      <main className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={st.eyebrow} title={st.title} text={st.text} />
        <div className="mx-auto mt-10 max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <span className={clsx('flex h-12 w-12 items-center justify-center rounded-full', status === 'ok' ? 'bg-emerald-50 text-emerald-700' : status === 'error' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700')}>
              <Activity className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-950">
                {status === 'ok' ? st.operational : status === 'error' ? st.needsAttention : '…'}
              </h2>
              <p className="mt-1 text-slate-600">{details}</p>
            </div>
          </div>
        </div>
      </main>
    </PublicLayout>
  );
}

// Каждая экспортируемая страница оборачивается в свой LanguageProvider —
// он лёгкий (localStorage + один объект словаря в памяти), а страницы
// монтируются по одной за раз через роутер, так что дублирования по факту
// не происходит; зато не пришлось трогать App.tsx ради общего провайдера
// на всё приложение (эти семь страниц — единственное, что пользуется i18n).
export function HomePage() { return <LanguageProvider><HomePageInner /></LanguageProvider>; }
export function DownloadPage() { return <LanguageProvider><DownloadPageInner /></LanguageProvider>; }
export function DocsPage() { return <LanguageProvider><DocsPageInner /></LanguageProvider>; }
export function FaqPage() { return <LanguageProvider><FaqPageInner /></LanguageProvider>; }
export function SupportPage() { return <LanguageProvider><SupportPageInner /></LanguageProvider>; }
export function PrivacyPage() { return <LanguageProvider><PrivacyPageInner /></LanguageProvider>; }
export function StatusPage() { return <LanguageProvider><StatusPageInner /></LanguageProvider>; }
