import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Project, ProjectSummary } from '../../features/editor/domain/editor.types';
import { approveReadyCompositions, getProject, listProjects, reviewProject } from '../../lib/videoApi';
import { Header } from '../main/Header';
import { StepIndicator } from '../ui';
import '../workflow/workflow.css';

type ReviewStatus = 'pending' | 'ready' | 'needs-adjustment';

function getReviewLabel(status: ReviewStatus) {
  return {
    pending: 'Ainda não verificado',
    ready: 'Formato correto',
    'needs-adjustment': 'Encaminhar para ajustes',
  }[status];
}

function getCaptionSummary(composition: Project['compositions'][number]) {
  const settings = composition.captionSettings;
  if (settings?.mode === 'none') {
    return 'Sem legenda';
  }

  const cueCount = composition.captionTrack?.cues?.length || composition.captionTrack?.words?.length || 0;
  const mode = settings?.mode === 'manual' ? 'Legenda manual' : 'Legenda automática';
  return `${mode} · ${cueCount > 0 ? `${cueCount} entrada(s) sincronizada(s)` : 'gerada durante a exportação'}`;
}

function getCompositionDuration(composition: Project['compositions'][number]) {
  return `${Math.max(0, Math.round(Number(composition.durationMs || 0) / 1000))}s`;
}

function getSemanticStatusLabel(status: 'ready' | 'needs-adjustment' | 'insufficient-data') {
  return {
    ready: 'Sentido preservado',
    'needs-adjustment': 'Revisar sentido',
    'insufficient-data': 'Sem dados suficientes',
  }[status];
}

export function AnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const requestedProjectId = searchParams.get('projectId');
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [collapsedCompositionIds, setCollapsedCompositionIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const compositions = project?.compositions || [];
  const reviewedCompositions = compositions.filter((composition) => composition.review?.status && composition.review.status !== 'pending');
  const readyCompositions = compositions.filter((composition) => composition.review?.status === 'ready');
  const readyToApproveCount = readyCompositions.filter((composition) => composition.status !== 'approved').length;
  const allReviewed = compositions.length > 0 && reviewedCompositions.length === compositions.length;
  const allEligibleApproved = readyCompositions.length > 0 && readyCompositions.every((composition) => composition.status === 'approved');
  const allReviewedCollapsed = reviewedCompositions.length > 0 && reviewedCompositions.every(
    (composition) => collapsedCompositionIds.has(composition.id),
  );

  useEffect(() => {
    listProjects()
      .then((loadedProjects) => {
        const readyProjects = loadedProjects.filter((currentProject) => !currentProject.isLayoutDraft);
        setProjects(readyProjects);
        const nextProjectId =
          readyProjects.find((currentProject) => currentProject.id === requestedProjectId)?.id ||
          readyProjects[0]?.id ||
          '';
        setSelectedProjectId(nextProjectId);
        if (nextProjectId && nextProjectId !== requestedProjectId) {
          setSearchParams({ projectId: nextProjectId }, { replace: true });
        }
      })
      .catch(() => setError('Não foi possível carregar os projetos.'))
      .finally(() => setIsLoading(false));
  }, [requestedProjectId, setSearchParams]);

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
          setCollapsedCompositionIds(new Set());
        }
      })
      .catch(() => {
        if (isCurrent) {
          setError('Não foi possível carregar o projeto selecionado.');
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

  function toggleCompositionCollapsed(compositionId: string) {
    setCollapsedCompositionIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(compositionId)) {
        nextIds.delete(compositionId);
      } else {
        nextIds.add(compositionId);
      }
      return nextIds;
    });
  }

  function toggleReviewedCompositions() {
    setCollapsedCompositionIds((currentIds) => {
      const nextIds = new Set(currentIds);
      reviewedCompositions.forEach((composition) => {
        if (allReviewedCollapsed) {
          nextIds.delete(composition.id);
        } else {
          nextIds.add(composition.id);
        }
      });
      return nextIds;
    });
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
      setCollapsedCompositionIds(new Set());
      setMessage('Verificação concluída. Os cortes válidos podem ser aprovados; os demais ficam encaminhados para a futura página de ajustes.');
    } catch {
      setError('Não foi possível verificar os cortes.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function approveReadyCuts() {
    if (!project || !allReviewed || readyToApproveCount === 0) {
      return;
    }

    try {
      setIsApproving(true);
      setError('');
      const result = await approveReadyCompositions(project.id);
      setProject(result.project);
      setMessage(
        result.approvedCount > 0
          ? `${result.approvedCount} corte(s) válidos aprovados. Você já pode seguir para a seleção.`
          : 'Os cortes válidos já estavam aprovados. Você já pode seguir para a seleção.',
      );
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Não foi possível aprovar os cortes válidos.');
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace">
        <div className="workflow-heading">
          <div>
            <p className="eyebrow">Etapa 4 de 6</p>
            <h1>Verificar cortes</h1>
            <p>A página verifica automaticamente duração, enquadramento, canvas e legenda. Não é necessário editar nada aqui.</p>
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

        <StepIndicator currentStep={4} />

        {isLoading && <div className="route-panel">Carregando projetos...</div>}
        {isProjectLoading && !isLoading && <div className="route-panel">Carregando projeto...</div>}
        {error && <p className="workflow-error" role="alert">{error}</p>}

        {!isLoading && !error && projects.length === 0 && (
          <div className="workflow-card workflow-empty">
            <Bot size={34} />
            <h2>Nenhum projeto para verificar</h2>
            <p>Complete as etapas de armazenamento, layout e legenda primeiro.</p>
            <Link className="workflow-primary" to="/arquivos">Ir para arquivos <ArrowRight size={16} /></Link>
          </div>
        )}

        {!isLoading && !isProjectLoading && !error && project && (
          <section className="workflow-card">
            <div className="workflow-card-header">
              <div>
                <span className="eyebrow">Verificação automática</span>
                <h2>{compositions.length} cortes para verificar</h2>
                <p>Os melhores momentos são escolhidos na geração com sinais de fala, ganchos, movimento e presença de rosto.</p>
              </div>
              <div className="workflow-review-header-actions">
                {reviewedCompositions.length > 0 && (
                  <button className="workflow-secondary workflow-collapse-reviewed" type="button" onClick={toggleReviewedCompositions}>
                    {allReviewedCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    {allReviewedCollapsed ? 'Expandir verificados' : 'Recolher verificados'}
                  </button>
                )}
                <button className="workflow-primary" type="button" disabled={isAnalyzing || isApproving} onClick={() => void analyzeCuts()}>
                  <RefreshCw size={16} />
                  {isAnalyzing ? 'Verificando...' : 'Verificar cortes'}
                </button>
              </div>
            </div>

            {message && <p className="workflow-message" role="status">{message}</p>}

            <div className="workflow-review-list">
              {compositions.map((composition) => {
                const review = composition.review || { status: 'pending' as const, issues: [], semantic: undefined };
                const semantic = review.semantic;
                const hasIssues = review.status === 'needs-adjustment';
                const isCollapsed = collapsedCompositionIds.has(composition.id);

                return (
                  <article className={`workflow-review-card ${isCollapsed ? 'is-collapsed' : ''}`} key={composition.id}>
                    <div className="workflow-review-card-header">
                      <div className="workflow-review-summary">
                        <h3>{composition.title}</h3>
                        <p>Revisão {composition.revision} · {getCompositionDuration(composition)}</p>
                        <div className="workflow-review-meta">
                          <span className={`workflow-badge ${review.status}`}>
                            {hasIssues ? <AlertTriangle size={14} /> : review.status === 'ready' ? <CheckCircle2 size={14} /> : <Bot size={14} />}
                            {getReviewLabel(review.status)}
                          </span>
                          {review.status === 'ready' && composition.status !== 'approved' && (
                            <span className="workflow-badge awaiting-approval">Aguardando aprovação</span>
                          )}
                          {composition.status === 'approved' && (
                            <span className="workflow-badge approved"><CheckCircle2 size={14} /> Aprovado para seleção</span>
                          )}
                        </div>
                        {review.issues.length > 0 && (
                          <ul className="workflow-issues">
                            {review.issues.map((issue) => <li key={issue}>{issue}</li>)}
                          </ul>
                        )}
                      </div>
                      <button
                        className="workflow-review-toggle"
                        type="button"
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? `Expandir ${composition.title}` : `Recolher ${composition.title}`}
                        onClick={() => toggleCompositionCollapsed(composition.id)}
                      >
                        {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        {isCollapsed ? 'Expandir' : 'Recolher'}
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="workflow-review-readonly" aria-label={`Resumo de verificação de ${composition.title}`}>
                        <div className="workflow-review-format-grid">
                          <div><span>Duração</span><strong>{getCompositionDuration(composition)}</strong></div>
                          <div><span>Canvas</span><strong>{composition.canvas.width} × {composition.canvas.height}</strong></div>
                          <div><span>Legenda</span><strong>{getCaptionSummary(composition)}</strong></div>
                          <div><span>Status</span><strong>{composition.status === 'approved' ? 'Pronto para seleção' : hasIssues ? 'Aguardando ajustes' : 'Aguardando aprovação'}</strong></div>
                        </div>
                        {semantic && (
                          <div className={`workflow-semantic-review ${semantic.status}`}>
                            <div className="workflow-semantic-heading">
                              <div>
                                <span className="eyebrow">Leitura semantica</span>
                                <strong>{getSemanticStatusLabel(semantic.status)}</strong>
                              </div>
                              <span className="workflow-semantic-score">{semantic.score}%</span>
                            </div>
                            <p>{semantic.summary}</p>
                            {semantic.dimensions.length > 0 && (
                              <div className="workflow-semantic-dimensions">
                                {semantic.dimensions.map((dimension) => (
                                  <div className="workflow-semantic-dimension" key={dimension.id}>
                                    <div>
                                      <span>{dimension.label}</span>
                                      <strong>{dimension.score}%</strong>
                                    </div>
                                    <div className="workflow-semantic-meter"><span style={{ width: `${dimension.score}%` }} /></div>
                                    <small>{dimension.evidence}</small>
                                  </div>
                                ))}
                              </div>
                            )}
                            {semantic.issues.length > 0 && (
                              <ul className="workflow-semantic-issues">
                                {semantic.issues.map((issue) => <li key={issue}>{issue}</li>)}
                              </ul>
                            )}
                            {semantic.warnings.length > 0 && (
                              <ul className="workflow-semantic-warnings">
                                {semantic.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                              </ul>
                            )}
                            <small className="workflow-semantic-evidence">
                              {semantic.evidence.transcriptWordCount} palavras analisadas
                              {semantic.evidence.speechCoverage !== undefined && ` · ${Math.round(semantic.evidence.speechCoverage * 100)}% do trecho com fala`}
                            </small>
                          </div>
                        )}
                        {hasIssues && (
                          <div className="workflow-review-routing">
                            <AlertTriangle size={17} />
                            <span>Este corte será encaminhado para a página de ajustes quando ela estiver disponível.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {allReviewed && readyToApproveCount > 0 && (
              <div className="workflow-actions workflow-centered-actions analysis-actions">
                <button className="workflow-primary" type="button" disabled={isApproving || isAnalyzing} onClick={() => void approveReadyCuts()}>
                  <CheckCircle2 size={16} />
                  {isApproving ? 'Aprovando...' : `Aprovar ${readyToApproveCount} corte(s) válidos`}
                </button>
              </div>
            )}
            {allReviewed && readyToApproveCount === 0 && allEligibleApproved && (
              <div className="workflow-actions workflow-centered-actions analysis-actions">
                <Link className="workflow-primary" to={`/selecionar?projectId=${project.id}`}>
                  Ir para seleção
                  <ArrowRight size={16} />
                </Link>
              </div>
            )}
            {!allReviewed && (
              <p className="workflow-field-help">Execute a verificação para liberar a aprovação dos cortes válidos.</p>
            )}
            {allReviewed && readyToApproveCount === 0 && !allEligibleApproved && (
              <p className="workflow-field-help">Nenhum corte válido está disponível para seleção neste momento.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
