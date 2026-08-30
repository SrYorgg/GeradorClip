import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

type ClassName = string | boolean | null | undefined;

function joinClassNames(...classNames: ClassName[]) {
  return classNames.filter(Boolean).join(' ');
}

export function Panel({
  children,
  className,
  as: Component = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Component className={joinClassNames('cc-panel', className)}>{children}</Component>;
}

export function ToolButton({
  icon: Icon,
  label,
  active = false,
  onClick,
  type = 'button',
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      className={joinClassNames('cc-tool-button', active && 'is-active')}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

export function SidebarItem({
  label,
  to,
  icon: Icon,
  end = false,
  onClick,
}: {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      className={({ isActive }) => joinClassNames('nav-item', isActive && 'active')}
      end={end}
      to={to}
      title={label}
      onClick={onClick}
    >
      <span className="nav-icon">
        <Icon size={19} strokeWidth={1.8} />
      </span>
      <span className="sidebar-label">{label}</span>
    </NavLink>
  );
}

const workflowSteps = [
  ['1', 'Armazenar vídeo', '/arquivos'],
  ['2', 'Editar layout', '/projetos'],
  ['3', 'Produzir legenda', '/legendas'],
  ['4', 'Analisar cortes', '/analise'],
  ['5', 'Selecionar cortes', '/selecionar'],
  ['6', 'Cortes armazenados', '/galeria'],
] as const;

export function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <nav className="cc-step-indicator" aria-label="Etapas do fluxo de criação">
      <span className="cc-step-indicator-label">Fluxo</span>
      <div className="cc-step-list">
        {workflowSteps.map(([number, label, to]) => (
          <Link
            className={joinClassNames(
              'cc-step',
              Number(number) === currentStep && 'is-current',
              Number(number) < currentStep && 'is-complete',
            )}
            key={number}
            to={to}
            aria-current={Number(number) === currentStep ? 'step' : undefined}
            title={`${number}. ${label}`}
          >
            <span className="cc-step-number">{number}</span>
            <span className="cc-step-label">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function InspectorSection({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={joinClassNames('cc-inspector-section', className)}>
      <div className="cc-inspector-heading">
        {Icon && <Icon size={15} strokeWidth={1.8} />}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function Timeline({
  durationMs,
  currentMs = 0,
  children,
}: {
  durationMs: number;
  currentMs?: number;
  children?: ReactNode;
}) {
  const progress = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;

  return (
    <div className="cc-timeline" aria-label="Timeline do vídeo">
      <div className="cc-timeline-track">
        <span className="cc-timeline-progress" style={{ width: `${progress}%` }} />
        <span className="cc-timeline-playhead" style={{ left: `${progress}%` }} />
      </div>
      {children}
    </div>
  );
}

export function VideoCard({
  title,
  thumbnail,
  meta,
  status,
  actions,
  className,
}: {
  title: string;
  thumbnail?: string;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <article className={joinClassNames('cc-video-card', className)}>
      <div className="cc-video-card-thumb">
        {thumbnail ? <img src={thumbnail} alt="" /> : <span className="cc-thumb-placeholder" />}
        {status && <span className="cc-video-card-status">{status}</span>}
      </div>
      <div className="cc-video-card-body">
        <h3>{title}</h3>
        {meta && <div className="cc-video-card-meta">{meta}</div>}
        {actions && <div className="cc-video-card-actions">{actions}</div>}
      </div>
    </article>
  );
}

export function ClipCard({
  title,
  thumbnail,
  score,
  meta,
  actions,
  className,
}: {
  title: string;
  thumbnail?: string;
  score?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <article className={joinClassNames('cc-clip-card', className)}>
      <div className="cc-clip-card-thumb">
        {thumbnail ? <img src={thumbnail} alt="" /> : <span className="cc-thumb-placeholder" />}
      </div>
      <div className="cc-clip-card-body">
        <div className="cc-clip-card-heading">
          <h3>{title}</h3>
          {score && <span className="cc-clip-card-score">{score}</span>}
        </div>
        {meta && <div className="cc-clip-card-meta">{meta}</div>}
        {actions && <div className="cc-clip-card-actions">{actions}</div>}
      </div>
    </article>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="cc-empty-state">
      <span className="cc-empty-icon"><Icon size={22} strokeWidth={1.7} /></span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className="cc-empty-action">{action}</div>}
    </div>
  );
}
