import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronUp, Move, RefreshCw, Save, Type } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CaptionSettings, CaptionTrack, Project, ProjectSummary } from '../../features/editor/domain/editor.types';
import { getCaptionBackgroundColor, getCaptionSettings, updateCaptionCueText } from '../../lib/captionSettings';
import { getSubtitleFont, subtitleFonts } from '../../lib/subtitleFonts';
import { approveReadyCompositions, getProject, listProjects, reviewProject, saveComposition } from '../../lib/videoApi';
import { Header } from '../main/Header';
import { StepIndicator } from '../ui';
import '../workflow/workflow.css';

function getReviewLabel(status: 'pending' | 'ready' | 'needs-adjustment') {
  return {
    pending: 'Ainda não analisado',
    ready: 'Revisão pronta',
    'needs-adjustment': 'Precisa de ajuste',
  }[status];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getCaptionPreviewText(track: CaptionTrack | undefined, displayMode: CaptionSettings['displayMode']) {
  if (!track) {
    return '';
  }

  if (displayMode === 'word' && track.words?.[0]?.text) {
    return track.words[0].text;
  }

  return track.cues?.[0]?.text || track.words?.[0]?.text || '';
}

function getEditableCaptionTrack(track: CaptionTrack): CaptionTrack {
  if (track.cues?.length) {
    return track;
  }

  return {
    ...track,
    cues: (track.words || []).map((word) => ({
      id: `cue-${word.id}`,
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
    })),
  };
}

type CaptionPositionEditorProps = {
  videoUrl?: string;
  settings: CaptionSettings;
  previewText: string;
  onChange: (values: Pick<CaptionSettings, 'positionX' | 'positionY'>) => void;
};

function CaptionPositionEditor({ videoUrl, settings, previewText, onChange }: CaptionPositionEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const captionStyle: CSSProperties = {
    left: `${settings.positionX ?? 50}%`,
    top: `${settings.positionY ?? 86}%`,
    width: settings.displayMode === 'word' ? 'auto' : `${settings.maxWidthPct ?? 84}%`,
    color: settings.displayMode === 'word' ? settings.highlightColor : settings.textColor,
    backgroundColor: getCaptionBackgroundColor(settings),
    fontFamily: getSubtitleFont(settings.font || 'geist').cssFamily,
    fontSize: `${Math.max(11, Number(settings.fontSize || 42) * 0.42)}px`,
    textShadow: `0 1px 2px ${settings.outlineColor || '#111111'}, 0 2px 8px ${settings.outlineColor || '#111111'}`,
  };

  function moveCaption(event: ReactPointerEvent<Element>) {
    if (pointerIdRef.current !== event.pointerId || !stageRef.current) {
      return;
    }

    const bounds = stageRef.current.getBoundingClientRect();
    onChange({
      positionX: Math.round(clamp(((event.clientX - bounds.left) / bounds.width) * 100, 5, 95)),
      positionY: Math.round(clamp(((event.clientY - bounds.top) / bounds.height) * 100, 5, 95)),
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveCaption(event);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current === event.pointerId) {
      pointerIdRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function nudge(axis: 'x' | 'y', amount: number) {
    onChange({
      positionX: axis === 'x' ? clamp((settings.positionX ?? 50) + amount, 5, 95) : settings.positionX,
      positionY: axis === 'y' ? clamp((settings.positionY ?? 86) + amount, 5, 95) : settings.positionY,
    });
  }

  return (
    <div className="workflow-caption-position">
      <div className="workflow-caption-position-heading">
        <span>Posição no vídeo</span>
        <small>{Math.round(settings.positionX ?? 50)}% · {Math.round(settings.positionY ?? 86)}%</small>
      </div>
      <div
        className="workflow-caption-stage"
        ref={stageRef}
        onPointerMove={moveCaption}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') nudge('x', -1);
          if (event.key === 'ArrowRight') nudge('x', 1);
          if (event.key === 'ArrowUp') nudge('y', -1);
          if (event.key === 'ArrowDown') nudge('y', 1);
        }}
        tabIndex={0}
        role="application"
        aria-label="Arraste a legenda para escolher sua posição"
      >
        {videoUrl ? <video className="workflow-caption-stage-video" src={videoUrl} muted playsInline preload="metadata" /> : <div className="workflow-caption-stage-fallback" />}
        <button
          className="workflow-caption-draggable"
          type="button"
          style={captionStyle}
          onPointerDown={handlePointerDown}
          aria-label="Legenda. Arraste para posicionar"
        >
          <Move size={12} />
          {previewText || 'Sua legenda aparecerá aqui'}
        </button>
        <span className="workflow-caption-stage-hint">Arraste · setas para ajustar</span>
      </div>
    </div>
  );
}

type CaptionEditorProps = {
  composition: Project['compositions'][number];
  videoUrl?: string;
  track?: CaptionTrack;
  settings: CaptionSettings;
  isSaving: boolean;
  onTrackChange: (track: CaptionTrack) => void;
  onSettingsChange: (settings: Partial<CaptionSettings>) => void;
  onSave: () => void;
};

function CaptionEditor({ composition, videoUrl, track, settings, isSaving, onTrackChange, onSettingsChange, onSave }: CaptionEditorProps) {
  const cues = track?.cues || [];
  const previewText = getCaptionPreviewText(track, settings.displayMode);
  const positionPreset = settings.position || 'bottom';

  return (
    <div className="workflow-caption-editor">
      <div className="workflow-caption-editor-heading">
        <div>
          <span className="workflow-caption-kicker"><Type size={14} /> Legenda completa</span>
          <strong>Corrija o texto sem perder a sincronização</strong>
          <p>Edite cada fala abaixo. Os tempos originais são preservados; se você adicionar ou remover palavras, elas são redistribuídas dentro do mesmo trecho.</p>
        </div>
        <span className="workflow-caption-count">{cues.length} falas</span>
      </div>

      <div className="workflow-caption-editor-layout">
        <div className="workflow-caption-cues">
          {cues.length > 0 ? cues.map((cue, index) => (
            <label className="workflow-caption-cue" key={cue.id}>
              <span>{String(index + 1).padStart(2, '0')} · {Math.round(cue.startMs / 1000)}s–{Math.round(cue.endMs / 1000)}s</span>
              <textarea
                value={cue.text}
                rows={2}
                onChange={(event) => onTrackChange(updateCaptionCueText(track as CaptionTrack, cue.id, event.target.value))}
                aria-label={`Texto da fala ${index + 1}`}
              />
            </label>
          )) : (
            <div className="workflow-caption-empty">
              <strong>Ainda não há transcrição pronta neste corte.</strong>
              <span>Conclua a produção da legenda na etapa 3 e volte para revisar as palavras aqui.</span>
            </div>
          )}
        </div>

        <CaptionPositionEditor
          videoUrl={videoUrl}
          settings={settings}
          previewText={previewText}
          onChange={onSettingsChange}
        />
      </div>

      <div className="workflow-caption-controls">
        <label className="workflow-field">
          Fonte
          <select value={settings.font || 'geist'} onChange={(event) => onSettingsChange({ font: event.target.value })}>
            {subtitleFonts.map((font) => (
              <option value={font.id} key={font.id}>{font.label}</option>
            ))}
          </select>
        </label>
        <label className="workflow-field">
          Posição rápida
          <select
            value={positionPreset}
            onChange={(event) => {
              const position = event.target.value as CaptionSettings['position'];
              onSettingsChange({
                position,
                positionX: 50,
                positionY: position === 'top' ? 12 : position === 'middle' ? 50 : 86,
              });
            }}
          >
            <option value="top">Superior</option>
            <option value="middle">Centro</option>
            <option value="bottom">Inferior</option>
          </select>
        </label>
        <label className="workflow-field">
          Exibição
          <select value={settings.displayMode || 'block'} onChange={(event) => onSettingsChange({ displayMode: event.target.value as CaptionSettings['displayMode'] })}>
            <option value="block">Frase em blocos</option>
            <option value="word">Palavra ativa destacada</option>
          </select>
        </label>
        <label className="workflow-field workflow-range-field">
          Tamanho <strong>{Math.round(settings.fontSize || 42)} px</strong>
          <input type="range" min="24" max="96" step="1" value={settings.fontSize || 42} onChange={(event) => onSettingsChange({ fontSize: Number(event.target.value) })} />
        </label>
        <label className="workflow-field workflow-range-field">
          Largura máxima <strong>{Math.round(settings.maxWidthPct || 84)}%</strong>
          <input type="range" min="35" max="95" step="1" value={settings.maxWidthPct || 84} onChange={(event) => onSettingsChange({ maxWidthPct: Number(event.target.value) })} />
        </label>
        <label className="workflow-field workflow-color-field">
          Cor do texto
          <input type="color" value={settings.textColor || '#FFFFFF'} onChange={(event) => onSettingsChange({ textColor: event.target.value })} />
        </label>
        <label className="workflow-field workflow-color-field">
          Cor da palavra ativa
          <input type="color" value={settings.highlightColor || '#73DDBD'} onChange={(event) => onSettingsChange({ highlightColor: event.target.value })} />
        </label>
        <label className="workflow-field workflow-color-field">
          Cor do contorno
          <input type="color" value={settings.outlineColor || '#111111'} onChange={(event) => onSettingsChange({ outlineColor: event.target.value })} />
        </label>
        <label className="workflow-field workflow-range-field">
          Fundo <strong>{Math.round(Number(settings.backgroundOpacity || 0) * 100)}%</strong>
          <input type="range" min="0" max="1" step="0.05" value={settings.backgroundOpacity ?? 0.6} onChange={(event) => onSettingsChange({ backgroundOpacity: Number(event.target.value) })} />
        </label>
        <label className="workflow-field workflow-color-field">
          Cor do fundo
          <input type="color" value={settings.backgroundColor || '#000000'} onChange={(event) => onSettingsChange({ backgroundColor: event.target.value })} />
        </label>
      </div>

      <div className="workflow-caption-save-row">
        <span>As alterações de texto e aparência serão aplicadas a “{composition.title}”.</span>
        <button className="workflow-secondary" type="button" disabled={isSaving} onClick={onSave}>
          <Save size={15} />
          {isSaving ? 'Salvando...' : 'Salvar legenda e aparência'}
        </button>
      </div>
    </div>
  );
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
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, CaptionTrack>>({});
  const [captionSettingsDrafts, setCaptionSettingsDrafts] = useState<Record<string, CaptionSettings>>({});
  const [savingCaptionId, setSavingCaptionId] = useState<string | null>(null);
  const [collapsedCompositionIds, setCollapsedCompositionIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const allReviewed = Boolean(
    project &&
    project.compositions.length > 0 &&
    project.compositions.every((composition) => composition.review?.status === 'ready'),
  );
  const allApproved = Boolean(
    project &&
    project.compositions.length > 0 &&
    project.compositions.every((composition) => composition.status === 'approved'),
  );
  const readyToApproveCount = project?.compositions.filter(
    (composition) => composition.review?.status === 'ready' && composition.status !== 'approved',
  ).length || 0;
  const reviewedCompositionIds = project?.compositions
    .filter((composition) => composition.review?.status && composition.review.status !== 'pending')
    .map((composition) => composition.id) || [];
  const allReviewedCollapsed = reviewedCompositionIds.length > 0 && reviewedCompositionIds.every(
    (compositionId) => collapsedCompositionIds.has(compositionId),
  );

  function seedCaptionDrafts(nextProject: Project) {
    setCaptionDrafts(Object.fromEntries(
      nextProject.compositions
        .filter((composition) => composition.captionTrack)
        .map((composition) => [composition.id, getEditableCaptionTrack(composition.captionTrack as CaptionTrack)]),
    ));
    setCaptionSettingsDrafts(Object.fromEntries(
      nextProject.compositions.map((composition) => [composition.id, getCaptionSettings(composition.captionSettings)]),
    ));
  }

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
      .catch(() => setError('Nao foi possivel carregar os projetos.'))
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
          seedCaptionDrafts(loadedProject);
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
      if (allReviewedCollapsed) {
        reviewedCompositionIds.forEach((compositionId) => nextIds.delete(compositionId));
      } else {
        reviewedCompositionIds.forEach((compositionId) => nextIds.add(compositionId));
      }
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
      setMessage('Análise concluída. Ajuste os cortes sinalizados e aprove os cortes prontos para liberar a seleção.');
    } catch {
      setError('Nao foi possivel analisar os cortes.');
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
      setMessage('');
      const result = await approveReadyCompositions(project.id);
      setProject(result.project);
      setMessage(
        result.approvedCount > 0
          ? `${result.approvedCount} cortes aprovados. Agora escolha quais armazenar.`
          : 'Todos os cortes prontos já estavam aprovados. Agora escolha quais armazenar.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Nao foi possivel aprovar os cortes prontos.');
    } finally {
      setIsApproving(false);
    }
  }

  async function saveCaption(composition: Project['compositions'][number]) {
    const currentComposition = project?.compositions.find((current) => current.id === composition.id) || composition;
    if (!project) {
      return;
    }

    try {
      setSavingCaptionId(composition.id);
      setError('');
      const result = await saveComposition({
        ...currentComposition,
        captionTrack: captionDrafts[composition.id] || currentComposition.captionTrack,
        captionSettings: captionSettingsDrafts[composition.id] || getCaptionSettings(currentComposition.captionSettings),
      });
      setProject(result.project);
      if (result.composition.captionTrack) {
        setCaptionDrafts((current) => ({ ...current, [composition.id]: result.composition.captionTrack as CaptionTrack }));
      }
      setCaptionSettingsDrafts((current) => ({
        ...current,
        [composition.id]: getCaptionSettings(result.composition.captionSettings),
      }));
      setMessage(`Legenda de “${composition.title}” salva com sucesso.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nao foi possivel salvar a legenda.');
    } finally {
      setSavingCaptionId(null);
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

        <StepIndicator currentStep={4} />

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
              <div className="workflow-review-header-actions">
                {reviewedCompositionIds.length > 0 && (
                  <button className="workflow-secondary workflow-collapse-reviewed" type="button" onClick={toggleReviewedCompositions}>
                    {allReviewedCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    {allReviewedCollapsed ? 'Expandir revisados' : 'Recolher revisados'}
                  </button>
                )}
                <button className="workflow-primary" type="button" disabled={isAnalyzing || isApproving} onClick={() => void analyzeCuts()}>
                  <RefreshCw size={16} />
                  {isAnalyzing ? 'Analisando...' : 'Analisar cortes'}
                </button>
              </div>
            </div>

            {message && <p className="workflow-message">{message}</p>}

            <div className="workflow-review-list">
              {project.compositions.map((composition) => {
                const review = composition.review || { status: 'pending' as const, issues: [] };
                const hasIssues = review.status === 'needs-adjustment';
                const captionSettings = captionSettingsDrafts[composition.id] || getCaptionSettings(composition.captionSettings);
                const captionTrack = captionDrafts[composition.id] || (composition.captionTrack ? getEditableCaptionTrack(composition.captionTrack) : undefined);
                const sourceVideoUrl = project.assets.find((asset) => asset.type === 'video')?.url;
                const isCollapsed = collapsedCompositionIds.has(composition.id);

                return (
                  <article className={`workflow-review-card ${isCollapsed ? 'is-collapsed' : ''}`} key={composition.id}>
                    <div className="workflow-review-card-header">
                      <div className="workflow-review-summary">
                      <h3>{composition.title}</h3>
                      <p>Revisão {composition.revision} · {Math.round(composition.durationMs / 1000)}s</p>
                      <div className="workflow-review-meta">
                        <span className={`workflow-badge ${review.status}`}>
                          {hasIssues ? <AlertTriangle size={14} /> : review.status === 'ready' ? <CheckCircle2 size={14} /> : <Bot size={14} />}
                          {getReviewLabel(review.status)}
                        </span>
                        {review.status === 'ready' && composition.status !== 'approved' && (
                          <span className="workflow-badge awaiting-approval">
                            <Bot size={14} />
                            Aguardando aprovação
                          </span>
                        )}
                        {composition.status === 'approved' && (
                          <span className="workflow-badge approved">
                            <CheckCircle2 size={14} />
                            Aprovado para exportação
                          </span>
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
                      <>
                        <CaptionEditor
                      composition={composition}
                      videoUrl={sourceVideoUrl}
                      track={captionTrack}
                      settings={captionSettings}
                      isSaving={savingCaptionId === composition.id}
                      onTrackChange={(track) => setCaptionDrafts((current) => ({ ...current, [composition.id]: track }))}
                      onSettingsChange={(settings) => setCaptionSettingsDrafts((current) => ({
                        ...current,
                        [composition.id]: { ...captionSettings, ...settings },
                      }))}
                      onSave={() => void saveCaption(composition)}
                    />
                     <Link className="workflow-link" to={`/projetos/${project.id}/cortes/${composition.id}/editor`}>
                       {hasIssues ? 'Ajustar layout' : 'Abrir corte'}
                       <ArrowRight size={15} />
                     </Link>
                      </>
                    )}
                  </article>
                );
              })}
            </div>

            {allReviewed && !allApproved && (
              <div className="workflow-actions">
                <button className="workflow-primary" type="button" disabled={isApproving || isAnalyzing} onClick={() => void approveReadyCuts()}>
                  <CheckCircle2 size={16} />
                  {isApproving ? 'Aprovando...' : `Aprovar ${readyToApproveCount} cortes prontos`}
                </button>
              </div>
            )}
            {allReviewed && allApproved && (
              <div className="workflow-actions">
                <Link className="workflow-primary" to={`/selecionar?projectId=${project.id}`}>
                  Ir para seleção
                  <ArrowRight size={16} />
                </Link>
              </div>
            )}
            {!allReviewed && (
              <p className="workflow-field-help">Execute a análise e ajuste os cortes sinalizados. A aprovação em lote aparece quando todos estiverem prontos.</p>
            )}
            {allReviewed && !allApproved && (
              <p className="workflow-field-help">A análise terminou. Aprove os cortes prontos para liberar a seleção.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
