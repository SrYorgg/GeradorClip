import { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { listProjects } from '../../lib/videoApi';
import type { ProjectSummary } from '../../features/editor/domain/editor.types';
import { Header } from '../main/Header';

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
      .catch(() => setError('Nao foi possivel carregar os projetos.'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="projects-heading">
          <div>
            <p className="eyebrow">Projetos</p>
            <h1>Rascunhos de edição</h1>
            <p>Abra um corte, ajuste a timeline e aprove a composição antes da exportação.</p>
          </div>
          <Link className="secondary-action dark" to="/legendas">
            Criar rascunhos
            <ArrowRight size={16} />
          </Link>
        </div>

        {isLoading && <div className="route-panel">Carregando projetos...</div>}
        {error && <div className="route-panel">{error}</div>}

        {!isLoading && !error && projects.length === 0 && (
          <div className="route-panel projects-empty">
            <FolderOpen size={34} />
            <h2>Nenhum projeto criado</h2>
            <p>Crie rascunhos na página Legendas e abra qualquer corte no novo editor.</p>
          </div>
        )}

        {!isLoading && !error && projects.length > 0 && (
          <div className="projects-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-card-icon"><FolderOpen size={20} /></div>
                <div className="project-card-copy">
                  <span className="eyebrow">Projeto</span>
                  <h2>{project.title}</h2>
                  <p>{project.sourceName}</p>
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
