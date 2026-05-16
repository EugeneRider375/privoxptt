/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Основная палитра PrivoxPTT
        ptt: {
          green:  '#3DDC84',
          dark:   '#0A0C0A',
          panel:  '#111411',
          card:   '#161C16',
          border: '#1E2A1E',
          muted:  '#2A3A2A',
          text:   '#8BA888',
          active: '#3DDC84',
          danger: '#FF4444',
          warn:   '#FFB800',
          blue:   '#4A9EFF',
        },
      },
      fontFamily: {
        orbitron: ['Orbitron', 'monospace'],
        rajdhani: ['Rajdhani', 'sans-serif'],
        mono:     ['Share Tech Mono', 'monospace'],
      },
      animation: {
        'pulse-green': 'pulse-green 1.5s ease-in-out infinite',
        'wave':        'wave 1s ease-in-out infinite',
        'ping-slow':   'ping 2s cubic-bezier(0,0,0.2,1) infinite',
        'blink':       'blink 1s step-end infinite',
      },
      keyframes: {
        'pulse-green': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(61,220,132,0.4)' },
          '50%':       { boxShadow: '0 0 0 16px rgba(61,220,132,0)' },
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(0.4)' },
          '50%':      { transform: 'scaleY(1)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
      },
      boxShadow: {
        'glow-green': '0 0 20px rgba(61,220,132,0.3)',
        'glow-red':   '0 0 20px rgba(255,68,68,0.4)',
      },
    },
  },
  plugins: [],
};
