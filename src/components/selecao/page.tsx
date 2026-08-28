import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderCheck } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CaptionSettings, Project, ProjectSummary } from '../../features/editor/domain/editor.types';
import {
  exportClipsToGallery,
  getProject,
  listProjects,
  saveComposition,
} from '../../lib/videoApi';
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

const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  mode: 'automatic',
  manualText: '',
  corrections: '',
  font: 'inter',
  position: 'bottom',
  displayMode: 'block',
  language: 'pt-BR',
};

export function SelectionPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [project, setProject] = useState<Project | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isStoring, setIsStoring] = useState(false);
  const [error, setError] = useState('');
  const selectedCompositions = project?.compositions.filter((composition) => selectedIds.has(composition.id)) || [];
  const canStore = selectedCompositions.length > 0 && selectedCompositions.every(
    (composition) => composition.status === 'approved' && composition.review?.status === 'ready',
  );

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
        if (!isCurrent) {
          return;
        }
        setProject(loadedProject);
        setSelectedIds(new Set(loadedProject.compositions.filter((composition) => composition.selectedForExport !== false).map((composition) => composition.id)));
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
  }

  function toggleSelection(compositionId: string) {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(compositionId)) {
        nextIds.delete(compositionId);
      } else {
        nextIds.add(compositionId);
      }
      return nextIds;
    });
  }

  async function storeSelectedCuts() {
    if (!project || selectedIds.size === 0) {
      setError('Selecione pelo menos um corte para armazenar.');
      return;
    }

    if (!canStore) {
      setError('Analise e aprove todos os cortes selecionados antes de armazenar.');
      return;
    }

    try {
      setIsStoring(true);
      setError('');
      let latestProject = project;

      for (const composition of project.compositions) {
        const result = await saveComposition({
          ...composition,
          selectedForExport: selectedIds.has(composition.id),
        });
        latestProject = result.project;
      }

      const selectedCompositions = latestProject.compositions.filter((composition) => selectedIds.has(composition.id));
      const captionSettings = selectedCompositions[0]?.captionSettings || DEFAULT_CAPTION_SETTINGS;

      await exportClipsToGallery({
        videoId: latestProject.sourceVideoId,
        projectId: latestProject.id,
        clipIds: selectedCompositions.map((composition) => composition.clipId),
        compositionIds: selectedCompositions.map((composition) => composition.id),
        subtitleMode: captionSettings.mode,
        manualSubtitleText: captionSettings.manualText || '',
        subtitleCorrections: captionSettings.corrections || '',
        subtitleFont: captionSettings.font || 'inter',
        subtitlePosition: captionSettings.position || 'bottom',
        subtitleDisplayMode: captionSettings.displayMode || 'block',
        subtitleLanguage: captionSettings.language || 'pt-BR',
        audioMode: 'Audio original',
      });

      navigate('/galeria');
    } catch (error) {
      setError(error instanceof Error
        ? error.message
        : 'Nao foi possivel armazenar os cortes selecionados. Verifique se os cortes ja foram gerados no video.');
    } finally {
      setIsStoring(false);
    }
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace">
        <div className="workflow-heading">
          <div>
            <p className="eyebrow">Etapa 5 de 6</p>
            <h1>Selecionar cortes</h1>
            <p>Escolha quais cortes aprovados serão renderizados e armazenados na galeria.</p>
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
            <Link className={`workflow-step ${index === 4 ? 'active' : index < 4 ? 'done' : ''}`} to={to} key={number}>
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
            <FolderCheck size={34} />
            <h2>Nenhum projeto para selecionar</h2>
            <p>Complete as etapas anteriores antes de armazenar os cortes.</p>
            <Link className="workflow-primary" to="/arquivos">Ir para arquivos <ArrowRight size={16} /></Link>
          </div>
        )}

        {!isLoading && !isProjectLoading && !error && project && (
          <section className="workflow-card">
            <div className="workflow-card-header">
              <div>
                <span className="eyebrow">Seleção final</span>
                <h2>{selectedIds.size} de {project.compositions.length} cortes selecionados</h2>
                <p>Os cortes desmarcados continuam salvos no projeto e podem ser selecionados em outro momento.</p>
              </div>
              <FolderCheck size={28} />
            </div>

            <div className="workflow-selection-list">
              {project.compositions.map((composition) => {
                const reviewStatus = composition.review?.status || 'pending';
                const statusMessage = reviewStatus === 'needs-adjustment'
                  ? 'Precisa de ajuste antes da seleção.'
                  : reviewStatus === 'pending'
                    ? 'Ainda não analisado.'
                    : composition.status === 'approved'
                      ? 'Aprovado para armazenamento.'
                      : 'Revisado; aguardando aprovação.';
                return (
                  <label className="workflow-selection-card" key={composition.id}>
                    <input type="checkbox" checked={selectedIds.has(composition.id)} onChange={() => toggleSelection(composition.id)} />
                    <span>
                      <h3>{composition.title}</h3>
                      <p>{statusMessage}</p>
                    </span>
                    <strong>{Math.round(composition.durationMs / 1000)}s</strong>
                  </label>
                );
              })}
            </div>

            <div className="workflow-actions">
              <Link className="workflow-secondary" to={`/analise?projectId=${project.id}`}>
                <ArrowLeft size={16} />
                Voltar à análise
              </Link>
              <button className="workflow-primary" type="button" disabled={isStoring || !canStore} onClick={() => void storeSelectedCuts()}>
                <Check size={16} />
                {isStoring ? 'Armazenando...' : 'Armazenar cortes selecionados'}
              </button>
            </div>
            {!canStore && selectedIds.size > 0 && (
              <p className="workflow-field-help">
                Somente cortes aprovados após a análise podem ser armazenados.{' '}
                <Link className="workflow-inline-link" to={`/analise?projectId=${project.id}`}>Voltar à análise</Link>
              </p>
            )}
            {selectedIds.size === 0 && (
              <p className="workflow-field-help">Selecione pelo menos um corte aprovado para armazenar.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
