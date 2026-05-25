import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Radio, Users, Layers, Building2, LogOut, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { authApi } from '@/api/client';
import { AlertPanel } from '@/components/ui/AlertPanel';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';
import { AdminUsers } from './AdminUsers';
import { AdminGroups } from './AdminGroups';
import { AdminOrgs } from './AdminOrgs';
import { ActivityLogPage } from '../activity/ActivityLogPage';
import { DispatcherDashboard } from '../dispatcher/DispatcherDashboard';
import { disconnectPrivoxSocket, useSocket } from '@/hooks/useSocket';
import clsx from 'clsx';

const NAV = [
  { to: '/admin',          icon: Radio,      label: 'Console',       roles: ['SUPERADMIN','ADMIN','DISPATCHER'] },
  { to: '/admin/activity', icon: ClipboardList, label: 'Log',        roles: ['SUPERADMIN','ADMIN','DISPATCHER'] },
  { to: '/admin/users',    icon: Users,       label: 'Users',         roles: ['SUPERADMIN','ADMIN'] },
  { to: '/admin/groups',   icon: Layers,      label: 'Groups',        roles: ['SUPERADMIN','ADMIN'] },
  { to: '/admin/orgs',     icon: Building2,   label: 'Organizations', roles: ['SUPERADMIN'] },
];

export function AdminLayout() {
  const user = useStore((s) => s.user);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const navigate = useNavigate();

  useSocket();

  const visibleNav = NAV.filter((n) => user && n.roles.includes(user.role));

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

      <aside className={clsx(
        'flex flex-col bg-ptt-panel border-r border-ptt-border transition-all duration-200 shrink-0',
        sidebarOpen ? 'w-52' : 'w-12'
      )}>
        <div className="flex items-center gap-2 px-3 py-4 border-b border-ptt-border overflow-hidden">
          <PrivoxLogo className="h-6 w-6 shrink-0 rounded-md" markClassName="h-4 w-4" />
          {sidebarOpen && (
            <div className="overflow-hidden">
              <span className="font-orbitron text-sm font-bold text-white whitespace-nowrap">
                PRIVOX<span className="text-ptt-green">PTT</span>
              </span>
              <p className="font-mono text-ptt-muted text-xs">{user?.role}</p>
            </div>
          )}
        </div>

        <nav className="flex-1 py-2">
          {visibleNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
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

        <div className="border-t border-ptt-border p-3 space-y-2">
          {sidebarOpen && (
            <div>
              <p className="callsign text-xs truncate">{user?.callsign}</p>
              <p className="font-mono text-ptt-muted text-xs truncate">{user?.email}</p>
            </div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-2 text-ptt-muted hover:text-ptt-danger transition-colors">
            <LogOut className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="font-mono text-xs">LOG OUT</span>}
          </button>
        </div>

        <button
          onClick={() => useStore.getState().toggleSidebar()}
          className="flex items-center justify-center py-2 border-t border-ptt-border text-ptt-muted hover:text-white transition-colors"
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </aside>

      <main className="flex-1 overflow-hidden">
        <header className="flex items-center px-4 h-10 bg-ptt-panel border-b border-ptt-border">
          <span className="font-mono text-ptt-text text-xs tracking-widest">CONTROL PANEL · {user?.organization?.name}</span>
        </header>
        <div className="h-[calc(100%-40px)] overflow-auto">
          <Routes>
            <Route index element={<DispatcherDashboard />} />
            <Route path="activity" element={<ActivityLogPage />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="groups" element={<AdminGroups />} />
            <Route path="orgs" element={<AdminOrgs />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
