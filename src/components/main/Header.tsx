import {
  Bot,
  BookOpen,
  Check,
  FileVideo2,
  FolderOpen,
  Images,
  LayoutTemplate,
  Scissors,
  Sparkles,
  Star,
  Subtitles,
  Video,
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

const studioItems = [
  {
    label: 'Feed em massa',
    to: '/instagram',
    icon: LayoutTemplate,
    end: true,
  },
  {
    label: 'Editar vídeo',
    to: '/editor-video',
    icon: Video,
    end: true,
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
];

export function Header({}) {
  return (
    <aside
      className="sidebar"
      aria-label="Navegação principal"
    >
      <div className="sidebar-top">
        <div className="brand" role="img" aria-label="ClipCut">
          <span className="brand-mark">
            <Scissors size={20} strokeWidth={2.4} />
          </span>

          <span className="brand-name">ClipCut</span>
        </div>

        <nav className="nav-stack">
          <span className="nav-section-label">Criação rápida</span>
          {studioItems.map(({ label, to, icon, end }) => (
            <SidebarItem
              end={end}
              icon={icon}
              key={label}
              label={label}
              to={to}
            />
          ))}
          <div className="nav-divider" />
          <span className="nav-section-label">Fluxo de criação</span>
          {workflowItems.map(({ label, to, icon, end }) => (
            <SidebarItem
              end={end}
              icon={icon}
              key={label}
              label={label}
              to={to}
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
            />
          ))}
        </nav>
      </div>

    </aside>
  );
}
