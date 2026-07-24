import { NavLink } from 'react-router-dom';
import {
  MessageSquare, Settings, Brain, Mic, PanelLeftClose,
} from 'lucide-react';

const links = [
  { to: '/', icon: MessageSquare, label: 'Chat' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className="w-16 flex flex-col items-center gap-4 py-4 glass-dark border-r border-white/10">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
        <span className="text-xs font-bold text-white">W</span>
      </div>
      <nav className="flex flex-col gap-2 flex-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `p-2 rounded-xl transition-colors ${
                isActive
                  ? 'bg-primary/20 text-primary'
                  : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`
            }
            title={label}
          >
            <Icon size={20} />
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
