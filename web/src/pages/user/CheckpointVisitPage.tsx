import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, MapPin, XCircle } from 'lucide-react';
import { checkpointsApi } from '@/api/client';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';

/**
 * Куда ведёт QR-код на стене контрольной точки обхода (D49.2):
 * /checkpoint/<токен>. Открывается внутри приложения (см. MainActivity.java
 * и apple-app-site-association) — так же, как приглашение по QR (JoinPage).
 *
 * В отличие от JoinPage — маршрут защищён (`RequireAuth` в App.tsx),
 * посторонний без аккаунта до этого экрана просто не дойдёт, увидит login.
 *
 * Геопозиция — best-effort, тот же паттерн, что и у кнопки "Я прибыл"
 * (useSocket.reportArrived): свежие координаты на момент открытия страницы,
 * не блокируем отметку визита, если разрешение не дали или GPS не успел.
 */
type Status = 'loading' | 'done' | 'error';

export function CheckpointVisitPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [checkpointName, setCheckpointName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    function submit(lat?: number, lng?: number) {
      checkpointsApi
        .visit(token, { lat, lng })
        .then((res) => {
          if (cancelled) return;
          setCheckpointName(res.checkpointName);
          setStatus('done');
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e?.response?.data?.error ?? 'Failed to record checkpoint visit');
          setStatus('error');
        });
    }

    if (!navigator.geolocation) {
      submit();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => submit(pos.coords.latitude, pos.coords.longitude),
      () => submit(), // отказали в доступе или не успели — всё равно засчитываем визит
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 8_000 },
    );

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-ptt-dark flex flex-col items-center justify-center p-6 text-center">
      <PrivoxLogo className="h-12 w-12 rounded-xl mb-6" markClassName="h-7 w-7" />

      {status === 'loading' && (
        <>
          <Loader2 className="w-10 h-10 text-ptt-green animate-spin mb-4" />
          <p className="font-mono text-ptt-muted text-sm">Отмечаем визит…</p>
        </>
      )}

      {status === 'done' && (
        <>
          <CheckCircle2 className="w-14 h-14 text-ptt-green mb-4" />
          <p className="font-orbitron text-white text-lg tracking-wide mb-1">Отмечено</p>
          <p className="font-mono text-ptt-text text-sm flex items-center gap-1.5 mb-1">
            <MapPin className="w-3.5 h-3.5 text-ptt-muted" /> {checkpointName}
          </p>
          <p className="font-mono text-ptt-muted text-xs mb-6">{new Date().toLocaleTimeString()}</p>
          <button
            onClick={() => navigate('/app')}
            className="bg-ptt-green text-ptt-dark font-orbitron text-xs px-5 py-2 rounded tracking-widest hover:bg-ptt-green/90"
          >
            ГОТОВО
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <XCircle className="w-14 h-14 text-ptt-danger mb-4" />
          <p className="font-orbitron text-white text-lg tracking-wide mb-1">Не получилось</p>
          <p className="font-mono text-ptt-muted text-xs mb-6 max-w-xs">{error}</p>
          <button
            onClick={() => navigate('/app')}
            className="border border-ptt-border text-ptt-text font-orbitron text-xs px-5 py-2 rounded tracking-widest hover:text-white hover:border-ptt-text/60"
          >
            НА ГЛАВНУЮ
          </button>
        </>
      )}
    </div>
  );
}
