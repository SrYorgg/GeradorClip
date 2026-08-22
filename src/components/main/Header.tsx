import { useState } from 'react';
import {
  FileVideo2,
  Images,
  LayoutDashboard,
  LogOut,
  Scissors,
  Star,
  Trash2,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import './Header.css';

const navItems = [
  {
    label: 'Painel',
    to: '/',
    icon: LayoutDashboard,
    end: true,
  },
  {
    label: 'Galeria',
    to: '/galeria',
    icon: Images,
  },
  {
    label: 'Arquivos',
    to: '/arquivos',
    icon: FileVideo2,
  },
  {
    label: 'Favoritos',
    to: '/favoritos',
    icon: Star,
  },
  {
    label: 'Lixeira',
    to: '/lixeira',
    icon: Trash2,
  },
];

export function Header({}) {
  const [isPinned, setIsPinned] = useState(false);

  return (
    <aside
      className={`sidebar${isPinned ? ' is-expanded' : ''}`}
      aria-label="Navegação principal"
    >
      <div className="sidebar-top">
        <button
          type="button"
          className="brand"
          aria-expanded={isPinned}
          aria-label={
            isPinned ? 'Recolher menu lateral' : 'Expandir menu lateral'
          }
          onClick={() => setIsPinned((current) => !current)}
        >
          <span className="brand-mark">
            <Scissors size={20} strokeWidth={2.4} />
          </span>

          <span className="brand-name">GeradorClip</span>
        </button>

        <nav className="nav-stack">
          {navItems.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}`
              }
              end={end}
              key={label}
              to={to}
              title={label}
              onClick={() => setIsPinned(false)}
            >
              <span className="nav-icon">
                <Icon size={19} strokeWidth={1.8} />
              </span>

              <span className="sidebar-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-divider" />

        <div className="profile">
          <div className="profile-avatar" aria-hidden="true">
          </div>

          <div className="profile-copy">
            <strong></strong>
            <span></span>
          </div>
        </div>

        <button type="button" className="logout-button">
          <span className="nav-icon">
            <LogOut size={19} strokeWidth={1.8} />
          </span>

          <span className="sidebar-label">Sair</span>
        </button>
      </div>
    </aside>
  );
}