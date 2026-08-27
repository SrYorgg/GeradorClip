import { useState } from 'react';
import {
  Bot,
  BookOpen,
  Check,
  FileVideo2,
  FolderOpen,
  Images,
  LogOut,
  Scissors,
  Settings,
  Star,
  Subtitles,
  Video,
  Trash2,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import './Header.css';

const workflowItems = [
  {
    label: 'Armazenar vídeo',
    to: '/arquivos',
    icon: FileVideo2,
    end: true,
  },
  {
    label: 'Editar layout',
    to: '/projetos',
    icon: Video,
  },
  {
    label: 'Produzir legenda',
    to: '/legendas',
    icon: Subtitles,
  },
  {
    label: 'Analisar cortes',
    to: '/analise',
    icon: Bot,
  },
  {
    label: 'Selecionar cortes',
    to: '/selecionar',
    icon: Check,
  },
  {
    label: 'Cortes armazenados',
    to: '/galeria',
    icon: Images,
  },
];

const utilityItems = [
  {
    label: 'Biblioteca',
    to: '/biblioteca',
    icon: BookOpen,
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
  {
    label: 'Ajustes',
    to: '/ajustes',
    icon: Settings,
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
          <span className="nav-section-label">Fluxo de criação</span>
          {workflowItems.map(({ label, to, icon: Icon, end }) => (
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
          <div className="nav-divider" />
          <span className="nav-section-label">Organização</span>
          {utilityItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}`
              }
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
