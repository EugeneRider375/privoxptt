import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';

// Отправляет геолокацию на сервер каждые 10 секунд
export function useGeolocation(enabled = true) {
  const { sendLocation } = useSocket();
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        sendLocation(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.heading ?? undefined,
          pos.coords.speed ?? undefined
        );
      },
      (err) => console.warn('[GPS]', err.message),
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [enabled, sendLocation]);
}
