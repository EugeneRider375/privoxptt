import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from '@/store/useStore';
import { refreshSession } from '@/api/client';
import './index.css';

// Restore persisted auth/state from localStorage *before* the first render, so
// route guards (RequireAuth) see a saved session immediately. Otherwise on a
// cold start the first render runs with accessToken=null and bounces to /login
// before the async rehydrate (previously in App's useEffect) finishes.
// localStorage is synchronous, so this applies the saved state in time.
// Fixes the "login on every launch" cold-start issue (T320 wrapper and phones).
void useStore.persist.rehydrate();

// Сразу после гидрации продлеваем сессию: сервер ротирует refresh-токен и
// отодвигает срок на год от текущего момента. Благодаря этому рация и телефон
// логинятся один раз, а дальше достаточно включать. Не ждём ответа, чтобы
// старт без сети не упирался в таймаут.
void refreshSession();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
