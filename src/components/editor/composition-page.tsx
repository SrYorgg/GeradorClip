import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  Crop,
  Grid3X3,
  Move,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  approveComposition,
  getProject,
  saveComposition,
} from '../../lib/videoApi';
import type { CanvasPreset, Composition, CropMode, TrackItem } from '../../features/editor/domain/editor.types';
import {
  getCanvasLabel,
  getCompositionRegion,
  getTransform,
  LAYOUT_PRESETS,
} from '../../features/editor/domain/layout';
import {
  editorReducer,
  initialEditorState,
} from '../../features/editor/store/editor.store';
import './composition-page.css';

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatStatus(status: Composition['status']) {
  return {
    suggested: 'Sugerido',
    editing: 'Em edição',
    approved: 'Aprovado',
    exporting: 'Exportando',
    completed: 'Concluído',
    error: 'Com erro',
  }[status];
}

function getVideoItems(composition: Composition | null) {
  return composition?.tracks.find((track) => track.kind === 'video')?.items || [];
}

function getItemDuration(item: TrackItem) {
  return Math.max(item.sourceOutMs - item.sourceInMs, 100);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getActivePreset(composition: Composition): CanvasPreset {
  if (composition.layout.preset) {
    return composition.layout.preset;
  }

  return LAYOUT_PRESETS.find(
    (preset) => preset.width === composition.canvas.width && preset.height === composition.canvas.height,
  )?.id || 'custom';
}

function getRatioLabel(width: number, height: number) {
  const divisor = (a: number, b: number): number => (b === 0 ? a : divisor(b, a % b));
  const gcd = divisor(Math.round(width), Math.round(height));
  return `${Math.round(width / gcd)}:${Math.round(height / gcd)}`;
}

function getObjectPosition(value: number) {
  return `${clamp(50 + value / 2, 0, 100)}%`;
}

export function CompositionEditorPage() {
  const { projectId, clipId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Awaited<ReturnType<typeof getProject>> | null>(null);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragPreview, setDragPreview] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const latestCompositionRef = useRef<Composition | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  useEffect(() => {
    if (!projectId) {
      navigate('/projetos', { replace: true });
      return;
    }

    let isCurrent = true;
    setIsLoading(true);
    getProject(projectId)
      .then((loadedProject) => {
        if (!isCurrent) {
          return;
        }

        const selectedComposition =
          loadedProject.compositions.find((composition) => composition.id === clipId) ||
          loadedProject.compositions[0];

        setProject(loadedProject);
        if (selectedComposition) {
          dispatch({ type: 'load', composition: selectedComposition });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setError('Nao foi possivel carregar o projeto.');
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [clipId, navigate, projectId]);

  const composition = state.composition;
  const items = useMemo(() => getVideoItems(composition), [composition]);
  const selectedItem = items.find((item) => item.id === state.selectedItemId) || items[0] || null;
  const sourceAsset = project?.assets.find((asset) => asset.id === selectedItem?.assetId) || project?.assets[0];
  const selectedRegion = composition ? getCompositionRegion(composition, selectedItem) : null;
  const selectedTransform = getTransform(selectedItem);
  const visibleTransform = dragPreview && dragPreview.itemId === selectedItem?.id
    ? { ...selectedTransform, x: dragPreview.x, y: dragPreview.y }
    : selectedTransform;
  const activePreset = composition ? getActivePreset(composition) : 'vertical';
  const canvasStyle: CSSProperties = composition
    ? {
        aspectRatio: `${composition.canvas.width} / ${composition.canvas.height}`,
        background: composition.layout.background || '#05050a',
      }
    : {};
  const videoStyle: CSSProperties = selectedRegion
    ? {
        left: `${selectedRegion.xPct}%`,
        top: `${selectedRegion.yPct}%`,
        width: `${selectedRegion.widthPct}%`,
        height: `${selectedRegion.heightPct}%`,
        objectFit: visibleTransform.cropMode === 'contain' ? 'contain' : 'cover',
        objectPosition: `${getObjectPosition(visibleTransform.x)} ${getObjectPosition(visibleTransform.y)}`,
        transform: `scale(${visibleTransform.scale}) rotate(${visibleTransform.rotation || 0}deg)`,
      }
    : {};
  const regionFrameStyle: CSSProperties = selectedRegion
    ? {
        left: `${selectedRegion.xPct}%`,
        top: `${selectedRegion.yPct}%`,
        width: `${selectedRegion.widthPct}%`,
        height: `${selectedRegion.heightPct}%`,
      }
    : {};

  useEffect(() => {
    latestCompositionRef.current = composition;
  }, [composition]);

  const seekToPlayhead = useCallback((playheadMs: number) => {
    const video = videoRef.current;
    const item = latestCompositionRef.current?.tracks.find((track) => track.kind === 'video')?.items.find(
      (currentItem) => currentItem.id === state.selectedItemId,
    );

    if (!video || !item) {
      return;
    }

    const sourceTimeMs = item.sourceInMs + Math.max(0, playheadMs - item.timelineStartMs);
    video.currentTime = Math.min(item.sourceOutMs, sourceTimeMs) / 1000;
  }, [state.selectedItemId]);

  const persistComposition = useCallback(async () => {
    const currentComposition = latestCompositionRef.current;
    if (!currentComposition) {
      return null;
    }

    try {
      setIsSaving(true);
      setError('');
      dispatch({ type: 'set-save-state', saveState: 'saving' });
      const result = await saveComposition(currentComposition);
      setProject(result.project);

      if (latestCompositionRef.current === currentComposition) {
        dispatch({ type: 'mark-saved', composition: result.composition });
      } else {
        dispatch({
          type: 'sync-revision',
          revision: result.composition.revision,
          updatedAt: result.composition.updatedAt,
        });
      }

      setMessage('Rascunho salvo.');
      return result.composition;
    } catch {
      dispatch({ type: 'set-save-state', saveState: 'error' });
      setError('Nao foi possivel salvar o rascunho.');
      return null;
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!state.isDirty || !composition) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistComposition();
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [composition, persistComposition, state.isDirty]);

  useEffect(() => {
    if (!selectedItem || !videoRef.current) {
      return;
    }

    seekToPlayhead(state.playheadMs);
  }, [seekToPlayhead, selectedItem?.id]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!isSaving && state.isDirty) {
          void persistComposition();
        }
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isSaving, persistComposition, state.isDirty]);

  function selectComposition(nextComposition: Composition) {
    if (state.isDirty && !window.confirm('Existem alteracoes nao salvas. Trocar de corte?')) {
      return;
    }

    dispatch({ type: 'load', composition: nextComposition });
    navigate(`/projetos/${nextComposition.projectId}/cortes/${nextComposition.id}/editor`);
    setMessage('');
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || !selectedItem) {
      return;
    }

    const sourceTimeMs = Math.round(video.currentTime * 1000);
    const nextPlayhead = selectedItem.timelineStartMs + sourceTimeMs - selectedItem.sourceInMs;
    dispatch({ type: 'set-playhead', playheadMs: nextPlayhead });

    if (sourceTimeMs >= selectedItem.sourceOutMs) {
      video.pause();
      setIsPlaying(false);
      dispatch({
        type: 'set-playhead',
        playheadMs: selectedItem.timelineStartMs + getItemDuration(selectedItem),
      });
    }
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !selectedItem) {
      return;
    }

    if (video.paused) {
      seekToPlayhead(state.playheadMs);
      void video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function updateTrim(field: 'start' | 'end', value: string) {
    if (!selectedItem) {
      return;
    }

    const milliseconds = Math.round(Number(value || 0) * 1000);
    dispatch({
      type: 'trim-item',
      itemId: selectedItem.id,
      sourceInMs: field === 'start' ? milliseconds : selectedItem.sourceInMs,
      sourceOutMs: field === 'end' ? milliseconds : selectedItem.sourceOutMs,
    });
  }

  function updateTransform(field: 'x' | 'y' | 'scale' | 'rotation' | 'cropMode', value: string) {
    if (!selectedItem) {
      return;
    }

    const transformValue = field === 'cropMode' ? value as CropMode : Number(value);
    dispatch({
      type: 'update-transform',
      itemId: selectedItem.id,
      transform: { [field]: transformValue },
    });
  }

  function updateRegion(field: 'xPct' | 'yPct' | 'widthPct' | 'heightPct', value: string) {
    if (!selectedRegion) {
      return;
    }

    dispatch({
      type: 'update-region',
      regionId: selectedRegion.id,
      values: { [field]: Number(value) },
    });
  }

  function updateCanvasSize(field: 'width' | 'height', value: string) {
    if (!composition) {
      return;
    }

    dispatch({
      type: 'update-canvas-size',
      width: field === 'width' ? Number(value) : composition.canvas.width,
      height: field === 'height' ? Number(value) : composition.canvas.height,
    });
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectedItem) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialX: visibleTransform.x,
      initialY: visibleTransform.y,
    };
    setDragPreview({ itemId: selectedItem.id, x: visibleTransform.x, y: visibleTransform.y });
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !selectedItem) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    setDragPreview({
      itemId: selectedItem.id,
      x: clamp(drag.initialX + ((event.clientX - drag.startX) / bounds.width) * 200, -100, 100),
      y: clamp(drag.initialY + ((event.clientY - drag.startY) / bounds.height) * 200, -100, 100),
    });
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !selectedItem) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp(drag.initialX + ((event.clientX - drag.startX) / bounds.width) * 200, -100, 100);
    const y = clamp(drag.initialY + ((event.clientY - drag.startY) / bounds.height) * 200, -100, 100);
    dispatch({ type: 'update-transform', itemId: selectedItem.id, transform: { x, y } });
    dragRef.current = null;
    setDragPreview(null);
  }

  async function approveCurrentComposition() {
    const savedComposition = state.isDirty ? await persistComposition() : composition;
    if (!savedComposition) {
      return;
    }

    try {
      setError('');
      const result = await approveComposition(savedComposition);
      setProject(result.project);
      dispatch({ type: 'mark-saved', composition: result.composition });
      setMessage('Corte aprovado para exportacao.');
    } catch {
      setError('Nao foi possivel aprovar o corte.');
    }
  }

  if (isLoading) {
    return <div className="composition-loading">Carregando editor...</div>;
  }

  if (!project || !composition) {
    return (
      <main className="composition-loading">
        <p>{error || 'Nenhuma composicao encontrada.'}</p>
        <button type="button" onClick={() => navigate('/projetos')}>Voltar para projetos</button>
      </main>
    );
  }

  return (
    <main className="composition-editor-shell">
      <header className="composition-toolbar">
        <button className="composition-back" type="button" onClick={() => navigate('/projetos')}>
          <ArrowLeft size={17} />
          Projetos
        </button>
        <div className="composition-title">
          <span>{project.title}</span>
          <input
            aria-label="Nome do corte"
            value={composition.title}
            onChange={(event) => dispatch({ type: 'update-title', title: event.target.value })}
          />
          <small>Revisao {composition.revision}</small>
        </div>
        <div className="composition-actions">
          <span className={`composition-status status-${composition.status}`}>{formatStatus(composition.status)}</span>
          <button type="button" title="Desfazer" aria-label="Desfazer" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
            <Undo2 size={17} />
          </button>
          <button type="button" title="Refazer" aria-label="Refazer" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
            <Redo2 size={17} />
          </button>
          <button className="composition-save" type="button" disabled={!state.isDirty || isSaving} onClick={() => void persistComposition()}>
            <Save size={16} />
            {isSaving ? 'Salvando...' : 'Salvar rascunho'}
          </button>
          <button className="composition-approve" type="button" disabled={isSaving || composition.status === 'approved'} onClick={() => void approveCurrentComposition()}>
            <Check size={16} />
            Aprovar corte
          </button>
        </div>
      </header>

      <section className="composition-workspace">
        <aside className="composition-panel proposal-panel">
          <div className="composition-panel-heading">
            <div>
              <span className="composition-eyebrow">Rascunhos</span>
              <h2>Cortes sugeridos</h2>
            </div>
            <span>{project.compositions.length}</span>
          </div>
          <div className="proposal-list">
            {project.compositions.map((proposal) => (
              <button
                className={`proposal-card ${proposal.id === composition.id ? 'active' : ''}`}
                type="button"
                key={proposal.id}
                onClick={() => selectComposition(proposal)}
              >
                <span>{proposal.title}</span>
                <small>{formatTime(proposal.durationMs)} · {formatStatus(proposal.status)}</small>
              </button>
            ))}
          </div>
          <div className="proposal-help">
            <Scissors size={17} />
            <p>Abra um rascunho, ajuste o intervalo e aprove antes de exportar.</p>
          </div>
        </aside>

        <section className="composition-preview-panel">
          <div className="composition-preview-heading">
            <div>
              <span className="composition-eyebrow">Preview {getRatioLabel(composition.canvas.width, composition.canvas.height)}</span>
              <h1>{sourceAsset?.name || project.sourceName}</h1>
            </div>
            <span>{getCanvasLabel(composition.canvas)} · {composition.canvas.fps} fps</span>
          </div>
          <div
            className="composition-canvas"
            style={canvasStyle}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
            role="application"
            aria-label="Preview interativo. Arraste para reposicionar o vídeo."
          >
            {sourceAsset && (
              <video
                ref={videoRef}
                src={sourceAsset.url}
                style={videoStyle}
                preload="metadata"
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            )}
            {composition.layout.showSafeArea !== false && <div className="composition-safe-area" aria-hidden="true" />}
            {selectedRegion && <div className="composition-region-frame" style={regionFrameStyle} aria-hidden="true" />}
            <span className="composition-canvas-label">
              <Move size={12} /> Arraste para reposicionar
            </span>
          </div>
          <div className="composition-preview-controls">
            <button type="button" onClick={togglePlayback} aria-label={isPlaying ? 'Pausar preview' : 'Reproduzir preview'}>
              <Play size={17} fill="currentColor" />
              {isPlaying ? 'Pausar' : 'Reproduzir'}
            </button>
            <button type="button" onClick={() => seekToPlayhead(Math.max(0, state.playheadMs - 1000))}>-1s</button>
            <button type="button" onClick={() => seekToPlayhead(Math.min(composition.durationMs, state.playheadMs + 1000))}>+1s</button>
            <span>{formatTime(state.playheadMs)} / {formatTime(composition.durationMs)}</span>
          </div>
          <div className="composition-preview-hint">
            <Grid3X3 size={14} />
            <span>O contorno mostra a área do vídeo. O playhead controla o trecho selecionado.</span>
          </div>
        </section>

        <aside className="composition-panel inspector-panel">
          <div className="composition-panel-heading">
            <div>
              <span className="composition-eyebrow">Inspetor</span>
              <h2>Edicao do corte</h2>
            </div>
          </div>
          <div className="inspector-section layout-section">
            <div className="inspector-section-title">
              <SlidersHorizontal size={15} />
              <span className="inspector-label">Formato da composição</span>
            </div>
            <div className="layout-preset-grid">
              {LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={activePreset === preset.id ? 'active' : ''}
                  type="button"
                  onClick={() => dispatch({ type: 'set-layout-preset', preset: preset.id })}
                >
                  <strong>{preset.shortLabel}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
              <button
                className={activePreset === 'custom' ? 'active' : ''}
                type="button"
                onClick={() => dispatch({ type: 'set-layout-preset', preset: 'custom' })}
              >
                <strong>Custom</strong>
                <small>Dimensões próprias</small>
              </button>
            </div>
            <div className="inspector-fields">
              <label>
                Largura (px)
                <input type="number" min="320" max="3840" step="1" value={composition.canvas.width} onChange={(event) => updateCanvasSize('width', event.target.value)} />
              </label>
              <label>
                Altura (px)
                <input type="number" min="320" max="3840" step="1" value={composition.canvas.height} onChange={(event) => updateCanvasSize('height', event.target.value)} />
              </label>
            </div>
            <div className="inspector-inline-fields">
              <label className="color-field">
                Fundo
                <input type="color" value={composition.layout.background || '#05050a'} onChange={(event) => dispatch({ type: 'update-layout-settings', background: event.target.value })} />
              </label>
              <label className="toggle-field">
                <input type="checkbox" checked={composition.layout.showSafeArea !== false} onChange={(event) => dispatch({ type: 'update-layout-settings', showSafeArea: event.target.checked })} />
                Área segura
              </label>
            </div>
          </div>

          {selectedItem && (
            <>
              <div className="inspector-section">
                <span className="inspector-label">Intervalo do trecho</span>
                <div className="inspector-fields">
                  <label>
                    Inicio (s)
                    <input type="number" min="0" step="0.1" value={(selectedItem.sourceInMs / 1000).toFixed(1)} onChange={(event) => updateTrim('start', event.target.value)} />
                  </label>
                  <label>
                    Fim (s)
                    <input type="number" min="0.1" step="0.1" value={(selectedItem.sourceOutMs / 1000).toFixed(1)} onChange={(event) => updateTrim('end', event.target.value)} />
                  </label>
                </div>
                <p className="inspector-muted">Precisao de 100 ms · {formatTime(getItemDuration(selectedItem))}</p>
              </div>

              <div className="inspector-section">
                <div className="inspector-section-title">
                  <Crop size={15} />
                  <span className="inspector-label">Área do vídeo</span>
                </div>
                <div className="inspector-fields">
                  <label>
                    X (%)
                    <input type="number" min="0" max="100" step="1" value={selectedRegion?.xPct ?? 0} onChange={(event) => updateRegion('xPct', event.target.value)} />
                  </label>
                  <label>
                    Y (%)
                    <input type="number" min="0" max="100" step="1" value={selectedRegion?.yPct ?? 0} onChange={(event) => updateRegion('yPct', event.target.value)} />
                  </label>
                  <label>
                    Largura (%)
                    <input type="number" min="5" max="100" step="1" value={selectedRegion?.widthPct ?? 100} onChange={(event) => updateRegion('widthPct', event.target.value)} />
                  </label>
                  <label>
                    Altura (%)
                    <input type="number" min="5" max="100" step="1" value={selectedRegion?.heightPct ?? 100} onChange={(event) => updateRegion('heightPct', event.target.value)} />
                  </label>
                </div>
                <p className="inspector-muted">A área define onde o vídeo fica dentro do canvas.</p>
              </div>

              <div className="inspector-section">
                <div className="inspector-section-title">
                  <Move size={15} />
                  <span className="inspector-label">Enquadramento do trecho</span>
                </div>
                <div className="inspector-fields">
                  <label>
                    Posição X
                    <input type="number" min="-100" max="100" step="1" value={Math.round(visibleTransform.x)} onChange={(event) => updateTransform('x', event.target.value)} />
                  </label>
                  <label>
                    Posição Y
                    <input type="number" min="-100" max="100" step="1" value={Math.round(visibleTransform.y)} onChange={(event) => updateTransform('y', event.target.value)} />
                  </label>
                </div>
                <label className="range-field">
                  <span>Zoom <strong>{visibleTransform.scale.toFixed(2)}×</strong></span>
                  <input type="range" min="0.5" max="3" step="0.01" value={visibleTransform.scale} onChange={(event) => updateTransform('scale', event.target.value)} />
                </label>
                <div className="inspector-fields">
                  <label>
                    Rotação (°)
                    <input type="number" min="-180" max="180" step="1" value={Math.round(visibleTransform.rotation || 0)} onChange={(event) => updateTransform('rotation', event.target.value)} />
                  </label>
                  <label>
                    Preenchimento
                    <select value={visibleTransform.cropMode} onChange={(event) => updateTransform('cropMode', event.target.value)}>
                      <option value="cover">Preencher</option>
                      <option value="contain">Conter</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </label>
                </div>
                <button className="inspector-reset" type="button" onClick={() => dispatch({ type: 'reset-transform', itemId: selectedItem.id })}>
                  <RotateCcw size={14} />
                  Resetar enquadramento
                </button>
                <p className="inspector-muted">Arraste no preview ou use X/Y para encontrar a pessoa no quadro.</p>
              </div>

              <div className="inspector-section inspector-actions">
                <span className="inspector-label">Comandos reversiveis</span>
                <button type="button" onClick={() => dispatch({ type: 'split-item', itemId: selectedItem.id, splitAtMs: state.playheadMs })}>
                  <Scissors size={15} />
                  Dividir no playhead
                </button>
                <button type="button" disabled={items.length <= 1} onClick={() => dispatch({ type: 'delete-item', itemId: selectedItem.id })}>
                  <Trash2 size={15} />
                  Excluir segmento
                </button>
                <button type="button" onClick={() => dispatch({ type: 'duplicate-item', itemId: selectedItem.id })}>
                  <Copy size={15} />
                  Duplicar segmento
                </button>
              </div>

              <div className="inspector-section inspector-actions">
                <span className="inspector-label">Ordem</span>
                <div className="inspector-order-actions">
                  <button type="button" onClick={() => dispatch({ type: 'move-item', itemId: selectedItem.id, direction: 'up' })}>
                    <ArrowUp size={15} />
                    Subir
                  </button>
                  <button type="button" onClick={() => dispatch({ type: 'move-item', itemId: selectedItem.id, direction: 'down' })}>
                    <ArrowDown size={15} />
                    Descer
                  </button>
                </div>
              </div>
            </>
          )}
          <div className="inspector-ai-note">
            <strong>Decisao da IA</strong>
            <p>{composition.aiMetadata?.reasons?.[0] || 'Este corte foi criado como rascunho editavel.'}</p>
          </div>
        </aside>
      </section>

      <section className="composition-timeline-panel">
        <div className="composition-panel-heading">
          <div>
            <span className="composition-eyebrow">Timeline</span>
            <h2>Trilha de video</h2>
          </div>
          <span>{items.length} segmento(s)</span>
        </div>
        <input
          className="timeline-scrubber"
          aria-label="Playhead da timeline"
          type="range"
          min="0"
          max={composition.durationMs}
          step="100"
          value={state.playheadMs}
          onChange={(event) => {
            const nextPlayhead = Number(event.target.value);
            dispatch({ type: 'set-playhead', playheadMs: nextPlayhead });
            seekToPlayhead(nextPlayhead);
          }}
        />
        <div className="timeline-ruler">
          <span>0:00</span>
          <span>{formatTime(composition.durationMs / 2)}</span>
          <span>{formatTime(composition.durationMs)}</span>
        </div>
        <div className="timeline-track" aria-label="Segmentos do corte">
          {items.map((item) => {
            const width = Math.max((getItemDuration(item) / composition.durationMs) * 100, 6);
            const left = (item.timelineStartMs / composition.durationMs) * 100;
            return (
              <button
                key={item.id}
                className={`timeline-item ${item.id === selectedItem?.id ? 'active' : ''}`}
                style={{ width: `${width}%`, left: `${left}%` }}
                type="button"
                onClick={() => {
                  dispatch({ type: 'select-item', itemId: item.id });
                  dispatch({ type: 'set-playhead', playheadMs: item.timelineStartMs });
                  seekToPlayhead(item.timelineStartMs);
                }}
              >
                <span>{formatTime(getItemDuration(item))}</span>
              </button>
            );
          })}
          <span className="timeline-playhead" style={{ left: `${composition.durationMs ? (state.playheadMs / composition.durationMs) * 100 : 0}%` }} />
        </div>
        {message && <p className="composition-message">{message}</p>}
        {error && <p className="composition-error">{error}</p>}
      </section>
    </main>
  );
}
