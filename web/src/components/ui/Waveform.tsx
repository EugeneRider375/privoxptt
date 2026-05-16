import { useEffect, useRef } from 'react';
import clsx from 'clsx';

interface WaveformProps {
  active: boolean;
  color?: string;
  bars?: number;
  className?: string;
}

export function Waveform({ active, color = '#3DDC84', bars = 12, className }: WaveformProps) {
  const heights = useRef<number[]>(Array.from({ length: bars }, () => Math.random()));
  const frameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barW = width / bars - 2;

      for (let i = 0; i < bars; i++) {
        if (active) {
          heights.current[i] += (Math.random() - 0.5) * 0.3;
          heights.current[i] = Math.max(0.1, Math.min(1, heights.current[i]));
        } else {
          heights.current[i] += (0.2 - heights.current[i]) * 0.1;
        }

        const h = heights.current[i] * height;
        const x = i * (barW + 2);
        const y = (height - h) / 2;

        ctx.fillStyle = active ? color : '#2A3A2A';
        ctx.globalAlpha = active ? 0.8 + heights.current[i] * 0.2 : 0.4;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, 2);
        ctx.fill();
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [active, bars, color]);

  return (
    <canvas
      ref={canvasRef}
      width={bars * 10}
      height={40}
      className={clsx('w-full', className)}
    />
  );
}
