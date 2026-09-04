import { useEffect, useState } from 'react';
import {
  Bot,
  BookOpen,
  Check,
  FileVideo2,
  Images,
  LayoutTemplate,
  ChevronLeft,
  ChevronRight,
  Scissors,
  Settings,
  Sparkles,
  Star,
  Subtitles,
  UserRound,
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
    label: 'Produção inteligente',
    to: '/producao',
    icon: Sparkles,
    end: true,
  },
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

const SIDEBAR_STORAGE_KEY = 'clipcut.sidebar.collapsed';

export function Header() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isCollapsed));
    } catch {
      // A restricted browser storage must not block navigation.
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 681px)');
    const closeOnDesktop = () => {
      if (desktopQuery.matches) {
        setIsMobileOpen(false);
      }
    };

    closeOnDesktop();
    desktopQuery.addEventListener('change', closeOnDesktop);
    return () => desktopQuery.removeEventListener('change', closeOnDesktop);
  }, []);

  const closeMobileNavigation = () => setIsMobileOpen(false);
  const toggleSidebar = () => {
    if (isMobileOpen) {
      closeMobileNavigation();
      return;
    }

    setIsCollapsed((current) => !current);
  };

  return (
    <>
      <button
        className="mobile-sidebar-trigger"
        type="button"
        aria-controls="clipcut-sidebar"
        aria-expanded={isMobileOpen}
        aria-label={isMobileOpen ? 'Fechar navegação' : 'Abrir navegação'}
        onClick={() => setIsMobileOpen((current) => !current)}
      >
        {isMobileOpen ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}
        <span>Menu</span>
      </button>

      {isMobileOpen && (
        <button
          className="clipcut-sidebar-backdrop"
          type="button"
          aria-label="Fechar navegação"
          onClick={closeMobileNavigation}
        />
      )}

      <aside
        id="clipcut-sidebar"
        className="clipcut-sidebar"
        data-collapsed={isCollapsed}
        data-mobile-open={isMobileOpen}
        aria-label="Navegação principal"
      >
        <div className="clipcut-sidebar-scroll">
          <div className="clipcut-sidebar-top">
            <div className="clipcut-sidebar-heading">
              <div className="clipcut-brand" role="img" aria-label="ClipCut">
                <span className="clipcut-brand-mark">
                  <Scissors size={20} strokeWidth={2.4} />
                </span>
                <span className="clipcut-brand-name">ClipCut</span>
              </div>
            </div>

            <nav className="clipcut-nav-stack">
              <span className="nav-section-label clipcut-nav-section">Criação rápida</span>
              {studioItems.map(({ label, to, icon, end }) => (
                <SidebarItem
                  end={end}
                  icon={icon}
                  key={label}
                  label={label}
                  to={to}
                  onClick={closeMobileNavigation}
                />
              ))}
              <div className="nav-divider clipcut-nav-divider" />
              <span className="nav-section-label clipcut-nav-section">Fluxo de criação</span>
              {workflowItems.map(({ label, to, icon, end }) => (
                <SidebarItem
                  end={end}
                  icon={icon}
                  key={label}
                  label={label}
                  to={to}
                  onClick={closeMobileNavigation}
                />
              ))}
              <div className="nav-divider clipcut-nav-divider" />
              <span className="nav-section-label clipcut-nav-section">Organização</span>
              {utilityItems.map(({ label, to, icon }) => (
                <SidebarItem
                  icon={icon}
                  key={label}
                  label={label}
                  to={to}
                  onClick={closeMobileNavigation}
                />
              ))}
            </nav>
          </div>

          <div className="clipcut-sidebar-footer">
            <div className="sidebar-divider clipcut-sidebar-divider" />
            <span className="nav-section-label clipcut-nav-section">Preferências</span>
            <SidebarItem
              icon={Settings}
              label="Configurações"
              to="/ajustes"
              onClick={closeMobileNavigation}
            />
            <div className="clipcut-account" aria-label="Conta local do ClipCut">
              <span className="clipcut-account-avatar"><UserRound size={16} /></span>
              <span className="clipcut-account-copy">
                <strong>Conta local</strong>
                <small>Workspace ClipCut</small>
              </span>
            </div>
          </div>
        </div>

        <button
          className="clipcut-sidebar-toggle"
          type="button"
          aria-controls="clipcut-sidebar"
          aria-expanded={isMobileOpen || !isCollapsed}
          aria-label={isMobileOpen ? 'Fechar navegação' : isCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          title={isMobileOpen ? 'Fechar navegação' : isCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          onClick={toggleSidebar}
        >
          {isMobileOpen || !isCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </aside>
    </>
  );
}
