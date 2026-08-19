import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * QR-код рисуется прямо в браузере. Токен приглашения уже есть на странице —
 * отправлять его на сервер ради картинки незачем, а сервер его и не хранит:
 * в базе лежит только sha256.
 */

interface Props {
  value: string;
  /** Сторона картинки в пикселях. Для печати нужно не меньше 512. */
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * Уровень коррекции ошибок M: восстанавливает ~15% площади. Достаточно, чтобы
 * код читался с помятой или подпорченной бумаги, и при этом не раздувает сетку
 * так, как максимальный уровень H.
 */
export const QR_OPTIONS = {
  errorCorrectionLevel: 'M' as const,
  margin: 2,
  color: { dark: '#000000', light: '#FFFFFF' },
};

/** Ссылка → data:image/png. Используется и компонентом, и печатью, и скачиванием. */
export async function renderQrDataUrl(value: string, size = 512): Promise<string> {
  return QRCode.toDataURL(value, { ...QR_OPTIONS, width: size });
}

export function QrCode({ value, size = 160, className, alt }: Props) {
  const [dataUrl, setDataUrl] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    // Рисуем крупнее, чем показываем: та же картинка идёт на скачивание и печать.
    renderQrDataUrl(value, Math.max(size * 2, 512))
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (error) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        title="QR generation failed"
      >
        <div className="w-full h-full flex items-center justify-center border border-ptt-danger/50 rounded font-mono text-[10px] text-ptt-danger text-center p-2">
          QR FAILED
        </div>
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt={alt ?? 'Invitation QR code'}
      className={className}
      // Пока картинка не готова, держим место — иначе таблица прыгает.
      style={{ width: size, height: size, background: '#FFFFFF', borderRadius: 4 }}
    />
  );
}

/** Скачивание одного QR отдельным файлом. */
export async function downloadQr(value: string, filename: string, size = 1024): Promise<void> {
  const url = await renderQrDataUrl(value, size);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.click();
}
