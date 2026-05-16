import { useRef } from 'react';
import { Mic, Lock } from 'lucide-react';
import clsx from 'clsx';
import type { PttStatus } from '@/types';
import { unlockAudio } from '@/hooks/useWebRTC';

interface PTTButtonProps {
  status: PttStatus;
  onStart: () => void;
  onStop: () => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function PTTButton({ status, onStart, onStop, size = 'lg', disabled }: PTTButtonProps) {
  const isTransmitting = status === 'transmitting';
  const isReceiving = status === 'receiving';
  const isLocked = status === 'locked';
  const isBlocked = isReceiving || isLocked || disabled;
  const pressActiveRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

  const startPress = () => {
    unlockAudio().catch(() => {});
    if (isBlocked || pressActiveRef.current) return;
    pressActiveRef.current = true;
    onStart();
  };

  const stopPress = () => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    pointerIdRef.current = null;
    onStop();
  };

  const sizeClasses = {
    sm: 'w-24 h-24 text-2xl',
    md: 'w-32 h-32 text-3xl',
    lg: 'w-44 h-44 text-5xl',
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      {/* Кольцо-индикатор */}
      <div className={clsx('relative rounded-full p-2 transition-all duration-300', {
        'shadow-glow-green': isTransmitting,
        'shadow-[0_0_20px_rgba(74,158,255,0.4)]': isReceiving,
      })}>
        {isTransmitting && (
          <div className="absolute inset-0 rounded-full border-2 border-ptt-green animate-ping-slow opacity-60" />
        )}

        <button
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            pointerIdRef.current = e.pointerId;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            startPress();
          }}
          onPointerUp={(e) => {
            if (pointerIdRef.current === null || pointerIdRef.current === e.pointerId) {
              e.preventDefault();
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              stopPress();
            }
          }}
          onPointerCancel={stopPress}
          onLostPointerCapture={stopPress}
          onContextMenu={(e) => e.preventDefault()}
          aria-disabled={isBlocked}
          className={clsx(
            'rounded-full border-4 flex items-center justify-center transition-all duration-150 active:scale-95 touch-none',
            sizeClasses[size],
            {
              // Передаю
              'bg-ptt-green border-ptt-green text-ptt-dark shadow-glow-green scale-105':
                isTransmitting,
              // Слушаю чужую передачу
              'bg-ptt-card border-ptt-blue text-ptt-blue':
                isReceiving,
              // Канал заблокирован
              'bg-ptt-card border-ptt-muted text-ptt-muted cursor-not-allowed opacity-50':
                isLocked,
              // Готов к передаче
              'bg-ptt-card border-ptt-green text-ptt-green hover:bg-ptt-green/10 cursor-pointer':
                !isTransmitting && !isReceiving && !isLocked && !disabled,
            }
          )}
        >
          {isLocked ? (
            <Lock className="w-1/3 h-1/3" />
          ) : isReceiving ? (
            <Mic className="w-1/3 h-1/3" />
          ) : (
            <Mic className="w-1/3 h-1/3" />
          )}
        </button>
      </div>

      {/* Подпись */}
      <div className="font-mono text-xs tracking-widest text-center">
        {isTransmitting && <span className="text-ptt-green animate-blink">● ПЕРЕДАЧА</span>}
        {isReceiving && <span className="text-ptt-blue">● ПРИЁМ</span>}
        {isLocked && <span className="text-ptt-muted">КАНАЛ ЗАНЯТ</span>}
        {!isTransmitting && !isReceiving && !isLocked && (
          <span className="text-ptt-text">УДЕРЖИ ДЛЯ ПЕРЕДАЧИ</span>
        )}
      </div>

      {size === 'lg' && (
        <p className="font-mono text-ptt-muted/60 text-xs">или [ПРОБЕЛ]</p>
      )}
    </div>
  );
}
