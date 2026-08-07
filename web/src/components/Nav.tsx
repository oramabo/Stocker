import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Portfolio', icon: '▤' },
  { to: '/add', label: 'Add', icon: '＋' },
  { to: '/history', label: 'History', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Nav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-card/95 backdrop-blur border-t border-edge pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition ${
                isActive ? 'text-amber' : 'text-muted'
              }`
            }
          >
            <span aria-hidden className="text-base leading-none">
              {tab.icon}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
