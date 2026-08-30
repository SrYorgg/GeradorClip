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
  Sparkles,
  Star,
  Subtitles,
  Video,
  Trash2,
} from 'lucide-react';

import { SidebarItem } from '../ui';
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
    label: 'Inteligência editorial',
    to: '/editorial',
    icon: Sparkles,
  },
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

          <span className="brand-name">ClipCut</span>
        </button>

        <nav className="nav-stack">
          <span className="nav-section-label">Fluxo de criação</span>
          {workflowItems.map(({ label, to, icon, end }) => (
            <SidebarItem
              end={end}
              icon={icon}
              key={label}
              label={label}
              to={to}
              onClick={() => setIsPinned(false)}
            />
          ))}
          <div className="nav-divider" />
          <span className="nav-section-label">Organização</span>
          {utilityItems.map(({ label, to, icon }) => (
            <SidebarItem
              icon={icon}
              key={label}
              label={label}
              to={to}
              onClick={() => setIsPinned(false)}
            />
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-divider" />

        <div className="profile">
          <div className="profile-avatar" aria-hidden="true">
            GC
          </div>

          <div className="profile-copy">
            <strong>ClipCut</strong>
            <span>Workspace local</span>
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
