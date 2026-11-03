import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, BookMarked, Settings, Sparkles } from 'lucide-react';

const navItems = [
  { to: '/', label: '书架', icon: BookMarked, end: true },
  { to: '/read', label: '阅读', icon: BookOpen },
  { to: '/process', label: 'AI处理', icon: Sparkles },
  { to: '/settings', label: '设置', icon: Settings },
];

const Layout = () => {
  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center">
      <div className="w-full max-w-[480px] bg-background relative flex flex-col min-h-screen">
          <main className="flex-1 pb-[calc(60px+env(safe-area-inset-bottom))]">
          <div className="pb-6">
            <Outlet />
          </div>
        </main>
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-card/95 backdrop-blur-md border-t border-border z-50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center justify-around h-[60px] px-2">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors ${
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground/80'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={22}
                      strokeWidth={isActive ? 2.5 : 2}
                      className="transition-all"
                    />
                    <span className="text-[11px] font-medium">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
};

export default Layout;
