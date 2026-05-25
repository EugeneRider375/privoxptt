import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import {
  Radio, Users, Map, Bell, Settings, LogOut,
  ChevronLeft, ChevronRight, LayoutDashboard, ClipboardList,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { groupsApi, authApi } from '@/api/client';
import { AlertPanel } from '@/components/ui/AlertPanel';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';
import { DispatcherDashboard } from './DispatcherDashboard';
import { DispatcherMap } from './DispatcherMap';
import { DispatcherSettings } from './DispatcherSettings';
import { ActivityLogPage } from '../activity/ActivityLogPage';
import { disconnectPrivoxSocket, useSocket } from '@/hooks/useSocket';
import clsx from 'clsx';

const NAV = [
  { to: '/dispatcher',         icon: LayoutDashboard, label: 'Console' },
  { to: '/dispatcher/activity',icon: ClipboardList,    label: 'Log' },
  { to: '/dispatcher/map',     icon: Map,              label: 'Map' },
  { to: '/dispatcher/settings',icon: Settings,         label: 'Settings' },
];

export function DispatcherLayout() {
  const user = useStore((s) => s.user);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const allAlerts = useStore((s) => s.alerts);
  const alerts = allAlerts.filter((a) => !a.read);
  const navigate = useNavigate();

  useSocket();

  useEffect(() => {
    groupsApi.list().then((g) => useStore.getState().setGroups(g)).catch(console.error);
  }, []);

  async function handleLogout() {
    const rt = localStorage.getItem('refreshToken') ?? '';
    await authApi.logout(rt).catch(() => {});
    disconnectPrivoxSocket();
    useStore.getState().clearAuth();
    window.location.href = '/login';
  }

  return (
    <div className="h-full flex bg-ptt-dark overflow-hidden">
      <AlertPanel />

      {/* Боковое меню */}
      <aside className={clsx(
        'flex flex-col bg-ptt-panel border-r border-ptt-border transition-all duration-200 shrink-0',
        sidebarOpen ? 'w-48' : 'w-12'
      )}>
        {/* Лого */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-ptt-border overflow-hidden">
          <PrivoxLogo className="h-6 w-6 shrink-0 rounded-md" markClassName="h-4 w-4" />
          {sidebarOpen && (
            <span className="font-orbitron text-sm font-bold text-white whitespace-nowrap">
              PRIVOX<span className="text-ptt-green">PTT</span>
            </span>
          )}
        </div>

        {/* Навигация */}
        <nav className="flex-1 py-2">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dispatcher'}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2.5 mx-1 rounded transition-colors',
                isActive
                  ? 'bg-ptt-green/15 text-ptt-green'
                  : 'text-ptt-text hover:text-white hover:bg-ptt-muted/20'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="font-rajdhani font-semibold text-sm whitespace-nowrap">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Пользователь + выход */}
        <div className="border-t border-ptt-border p-3 space-y-2">
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="callsign text-xs truncate">{user?.callsign}</p>
              <p className="font-mono text-ptt-text text-xs truncate">{user?.role}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-ptt-muted hover:text-ptt-danger transition-colors w-full"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="font-mono text-xs">LOG OUT</span>}
          </button>
        </div>

        {/* Кнопка свернуть */}
        <button
          onClick={() => useStore.getState().toggleSidebar()}
          className="flex items-center justify-center py-2 border-t border-ptt-border text-ptt-muted hover:text-white transition-colors"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </aside>

      {/* Контент */}
      <main className="flex-1 overflow-hidden">
        {/* Топ бар */}
        <header className="flex items-center justify-between px-4 h-10 bg-ptt-panel border-b border-ptt-border">
          <div className="flex items-center gap-2">
            <span className="font-mono text-ptt-text text-xs tracking-widest">DISPATCH CONSOLE</span>
          </div>
          <div className="flex items-center gap-3">
            {alerts.length > 0 && (
              <div className="flex items-center gap-1">
                <Bell className="w-4 h-4 text-ptt-warn animate-blink" />
                <span className="font-mono text-ptt-warn text-xs">{alerts.length}</span>
              </div>
            )}
            <div className="online-dot" />
            <span className="font-mono text-ptt-text text-xs">{user?.displayName}</span>
          </div>
        </header>

        <div className="h-[calc(100%-40px)] overflow-auto">
          <Routes>
            <Route index element={<DispatcherDashboard />} />
            <Route path="activity" element={<ActivityLogPage />} />
            <Route path="map" element={<DispatcherMap />} />
            <Route path="settings" element={<DispatcherSettings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
