import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LanguageCode, SiteContent } from './types';
import { en } from './en';
import { ru } from './ru';
import { fr } from './fr';

const CONTENT: Record<LanguageCode, SiteContent> = { en, ru, fr };
const STORAGE_KEY = 'privoxptt-public-lang';

interface LanguageContextValue {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: SiteContent;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isLanguageCode(value: string | null): value is LanguageCode {
  return value === 'en' || value === 'ru' || value === 'fr';
}

/**
 * Язык публичного сайта (Home/Download/Docs/FAQ/Support/Privacy/Status) —
 * НЕ распространяется на само приложение (диспетчер/админка/рация), там
 * пока только английский (см. D58 в BACKLOG_RU.md, объём сознательно
 * ограничен публичным сайтом).
 *
 * По умолчанию — английский, тот же язык, что был на сайте до этого
 * переключателя: не хотим неожиданно менять язык для всех существующих
 * посетителей. Выбор запоминается в localStorage.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return isLanguageCode(stored) ? stored : 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // приватный режим/запрет на localStorage — молча продолжаем без сохранения
    }
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang: setLangState, t: CONTENT[lang] }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
