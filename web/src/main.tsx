import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from '@/store/useStore';
import './index.css';

// Restore persisted auth/state from localStorage *before* the first render, so
// route guards (RequireAuth) see a saved session immediately. Otherwise on a
// cold start the first render runs with accessToken=null and bounces to /login
// before the async rehydrate (previously in App's useEffect) finishes.
// localStorage is synchronous, so this applies the saved state in time.
// Fixes the "login on every launch" cold-start issue (T320 wrapper and phones).
void useStore.persist.rehydrate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
