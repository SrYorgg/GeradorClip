import { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { listProjects } from '../../lib/videoApi';
import type { ProjectSummary } from '../../features/editor/domain/editor.types';
import { Header } from '../main/Header';
import { StepIndicator } from '../ui';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setError('Não foi possível carregar os projetos.'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="projects-heading">
          <div>
            <p className="eyebrow">Etapa 2 de 6</p>
            <h1>Editar layout</h1>
            <p>Abra um corte, ajuste a proporção e o enquadramento, depois aprove a composição.</p>
          </div>
          <Link className="secondary-action dark" to="/arquivos">
            Armazenar vídeo
            <ArrowRight size={16} />
          </Link>
        </div>

        <StepIndicator currentStep={2} />

        {isLoading && <div className="route-panel">Carregando projetos...</div>}
        {error && <div className="route-panel">{error}</div>}

        {!isLoading && !error && projects.length === 0 && (
          <div className="route-panel projects-empty">
            <FolderOpen size={34} />
            <h2>Nenhum projeto criado</h2>
            <p>Armazene um vídeo em Arquivos e prepare os cortes para editar o layout.</p>
          </div>
        )}

        {!isLoading && !error && projects.length > 0 && (
          <div className="projects-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-card-icon"><FolderOpen size={20} /></div>
                <div className="project-card-copy">
                  <span className="eyebrow">{project.isLayoutDraft ? 'Rascunho de layout' : 'Projeto'}</span>
                  <h2>{project.title}</h2>
                  <p>{project.sourceName}</p>
                  {project.isLayoutDraft && <p className="project-draft-hint">Finalize o layout e gere os cortes para continuar.</p>}
                  <small>{project.compositionCount} corte(s) · atualizado em {formatDate(project.updatedAt)}</small>
                </div>
                {project.firstCompositionId && (
                  <Link
                    className="project-card-link"
                    to={`/projetos/${project.id}/cortes/${project.firstCompositionId}/editor`}
                  >
                    Abrir editor
                    <ArrowRight size={15} />
                  </Link>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
