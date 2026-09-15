import { Download, Mail, Phone, Globe } from 'lucide-react';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';
import { QrCode } from '@/components/ui/QrCode';
import { buildVCard, downloadVCard } from '@/utils/vcard';

// D56 — электронная визитка. Своя, минимальная страница (без общей шапки
// сайта PublicLayout) — задумана как экран, который открывают на своём
// телефоне и показывают собеседнику, а не как раздел сайта для чтения.
// QR кодирует vCard целиком, не ссылку на эту страницу — сохранение в
// контакты работает даже без интернета у того, кто сканирует (см. D56 в
// BACKLOG_RU.md: обсуждали и отклонили вариант "QR → ссылка", потому что
// без сети на выставке ссылка просто не откроется).
const CARD = {
  firstName: 'Evgeny',
  lastName: 'Labutin',
  org: 'PRIVOX PTT',
  title: 'Founder',
  phone: '+33677621005',
  email: 'eugene.labutin@gmail.com',
  urls: ['https://ptt.privox.tech', 'https://privox.tech'],
};

const vcard = buildVCard(CARD);

export function BusinessCardPage() {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-sky-50 via-white to-slate-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl shadow-sky-900/10">
        <PrivoxLogo className="mx-auto h-16 w-16 shadow-sm" markClassName="h-11 w-11" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
          {CARD.firstName} {CARD.lastName}
        </h1>
        <p className="mt-1 text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">{CARD.title}</p>
        <p className="text-sm text-slate-500">{CARD.org}</p>

        <div className="mx-auto mt-6 flex justify-center">
          <QrCode value={vcard} size={220} alt={`${CARD.firstName} ${CARD.lastName} — contact card`} />
        </div>
        <p className="mt-3 text-xs text-slate-500">Scan to save this contact — works without internet.</p>

        <div className="mt-6 space-y-2 text-left text-sm">
          <a href={`tel:${CARD.phone}`} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-slate-700 transition hover:border-sky-300 hover:text-sky-700">
            <Phone className="h-4 w-4 shrink-0 text-sky-600" />
            {CARD.phone}
          </a>
          <a href={`mailto:${CARD.email}`} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-slate-700 transition hover:border-sky-300 hover:text-sky-700">
            <Mail className="h-4 w-4 shrink-0 text-sky-600" />
            {CARD.email}
          </a>
          {CARD.urls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-slate-700 transition hover:border-sky-300 hover:text-sky-700">
              <Globe className="h-4 w-4 shrink-0 text-sky-600" />
              {url.replace(/^https?:\/\//, '')}
            </a>
          ))}
        </div>

        <button
          onClick={() => downloadVCard(vcard, `${CARD.firstName}-${CARD.lastName}.vcf`)}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700"
        >
          Save to contacts <Download className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
