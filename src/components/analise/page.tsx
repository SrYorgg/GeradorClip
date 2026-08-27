import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Project, ProjectSummary } from '../../features/editor/domain/editor.types';
import { getProject, listProjects, reviewProject } from '../../lib/videoApi';
import { Header } from '../main/Header';
import '../workflow/workflow.css';

const workflowSteps = [
  ['1', 'Armazenar vídeo', '/arquivos'],
  ['2', 'Editar layout', '/projetos'],
  ['3', 'Produzir legenda', '/legendas'],
  ['4', 'Analisar cortes', '/analise'],
  ['5', 'Selecionar cortes', '/selecionar'],
  ['6', 'Cortes armazenados', '/galeria'],
] as const;

function getReviewLabel(status: 'pending' | 'ready' | 'needs-adjustment') {
  return {
    pending: 'Ainda não analisado',
    ready: 'Pronto para seleção',
    'needs-adjustment': 'Precisa de ajuste',
  }[status];
}

export function AnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listProjects()
      .then((loadedProjects) => {
        const readyProjects = loadedProjects.filter((currentProject) => !currentProject.isLayoutDraft);
        setProjects(readyProjects);
        const requestedProjectId = searchParams.get('projectId');
        const nextProjectId =
          readyProjects.find((currentProject) => currentProject.id === requestedProjectId)?.id ||
          readyProjects[0]?.id ||
          '';
        setSelectedProjectId(nextProjectId);
        if (nextProjectId && nextProjectId !== requestedProjectId) {
          setSearchParams({ projectId: nextProjectId }, { replace: true });
        }
      })
      .catch(() => setError('Nao foi possivel carregar os projetos.'))
      .finally(() => setIsLoading(false));
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProject(null);
      return;
    }

    let isCurrent = true;
    setIsProjectLoading(true);
    setError('');
    getProject(selectedProjectId)
      .then((loadedProject) => {
        if (isCurrent) {
          setProject(loadedProject);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setError('Nao foi possivel carregar o projeto selecionado.');
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsProjectLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedProjectId]);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSearchParams({ projectId }, { replace: true });
    setMessage('');
  }

  async function analyzeCuts() {
    if (!project) {
      return;
    }

    try {
      setIsAnalyzing(true);
      setError('');
      setMessage('');
      const analyzedProject = await reviewProject(project.id);
      setProject(analyzedProject);
      setMessage('Análise concluída. Revise os cortes sinalizados antes de selecionar.');
    } catch {
      setError('Nao foi possivel analisar os cortes.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace">
        <div className="workflow-heading">
          <div>
            <p className="eyebrow">Etapa 4 de 6</p>
            <h1>Analisar cortes</h1>
            <p>Verifique enquadramento, área do canvas, zoom e configuração de legenda antes de salvar os cortes.</p>
          </div>
          {project && (
            <label className="workflow-project-select">
              Projeto ativo
              <select value={selectedProjectId} onChange={(event) => selectProject(event.target.value)}>
                {projects.map((currentProject) => (
                  <option value={currentProject.id} key={currentProject.id}>{currentProject.title}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <nav className="workflow-steps" aria-label="Etapas do fluxo de criação">
          {workflowSteps.map(([number, label, to], index) => (
            <Link className={`workflow-step ${index === 3 ? 'active' : index < 3 ? 'done' : ''}`} to={to} key={number}>
              <span className="workflow-step-number">{number}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        {isLoading && <div className="route-panel">Carregando projetos...</div>}
        {isProjectLoading && !isLoading && <div className="route-panel">Carregando projeto...</div>}
        {error && <p className="workflow-error">{error}</p>}

        {!isLoading && !error && projects.length === 0 && (
          <div className="workflow-card workflow-empty">
            <Bot size={34} />
            <h2>Nenhum projeto para analisar</h2>
            <p>Complete as etapas de armazenamento, layout e legenda primeiro.</p>
            <Link className="workflow-primary" to="/arquivos">Ir para arquivos <ArrowRight size={16} /></Link>
          </div>
        )}

        {!isLoading && !isProjectLoading && !error && project && (
          <section className="workflow-card">
            <div className="workflow-card-header">
              <div>
                <span className="eyebrow">Revisão assistida</span>
                <h2>{project.compositions.length} cortes para verificar</h2>
                <p>A análise é baseada nos dados salvos do Editor e pode ser repetida após qualquer ajuste.</p>
              </div>
              <button className="workflow-primary" type="button" disabled={isAnalyzing} onClick={() => void analyzeCuts()}>
                <RefreshCw size={16} />
                {isAnalyzing ? 'Analisando...' : 'Analisar cortes'}
              </button>
            </div>

            {message && <p className="workflow-message">{message}</p>}

            <div className="workflow-review-list">
              {project.compositions.map((composition) => {
                const review = composition.review || { status: 'pending' as const, issues: [] };
                const hasIssues = review.status === 'needs-adjustment';

                return (
                  <article className="workflow-review-card" key={composition.id}>
                    <div>
                      <h3>{composition.title}</h3>
                      <p>Revisão {composition.revision} · {Math.round(composition.durationMs / 1000)}s</p>
                      <div className="workflow-review-meta">
                        <span className={`workflow-badge ${review.status}`}>
                          {hasIssues ? <AlertTriangle size={14} /> : review.status === 'ready' ? <CheckCircle2 size={14} /> : <Bot size={14} />}
                          {getReviewLabel(review.status)}
                        </span>
                      </div>
                      {review.issues.length > 0 && (
                        <ul className="workflow-issues">
                          {review.issues.map((issue) => <li key={issue}>{issue}</li>)}
                        </ul>
                      )}
                    </div>
                    <Link className="workflow-link" to={`/projetos/${project.id}/cortes/${composition.id}/editor`}>
                      {hasIssues ? 'Ajustar layout' : 'Abrir corte'}
                      <ArrowRight size={15} />
                    </Link>
                  </article>
                );
              })}
            </div>

            {project.compositions.length > 0 && project.compositions.every((composition) => composition.review?.status === 'ready') && (
              <div className="workflow-actions">
                <Link className="workflow-primary" to={`/selecionar?projectId=${project.id}`}>
                Ir para seleção
                <ArrowRight size={16} />
                </Link>
              </div>
            )}
            {project.compositions.some((composition) => composition.review?.status !== 'ready') && (
              <p className="workflow-field-help">A selecao sera liberada depois que todos os cortes forem analisados e estiverem prontos.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
