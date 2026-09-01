import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CircleAlert,
  Copy,
  Crop,
  Grid3X3,
  ImagePlus,
  LoaderCircle,
  Move,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  approveComposition,
  deleteProjectImage,
  generateProjectClips,
  getProject,
  listUploadedVideos,
  saveComposition,
  uploadProjectImage,
} from '../../lib/videoApi';
import type { CanvasPreset, CaptionSettings, Composition, CropMode, TrackItem } from '../../features/editor/domain/editor.types';
import type { UploadedVideo } from '../../lib/videoApi';
import {
  getCanvasLabel,
  getCompositionRegion,
  getTransform,
  LAYOUT_PRESETS,
} from '../../features/editor/domain/layout';
import { DEFAULT_CAPTION_SETTINGS, getCaptionBackgroundColor, getCaptionSettings } from '../../lib/captionSettings';
import { getSubtitleFont } from '../../lib/subtitleFonts';
import {
  editorReducer,
  initialEditorState,
  MIN_CLIP_DURATION_MS,
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

function getMediaItems(composition: Composition | null) {
  return composition?.tracks.filter((track) => track.kind === 'media').flatMap((track) => track.items) || [];
}

function getVisualItems(composition: Composition | null) {
  return [...getVideoItems(composition), ...getMediaItems(composition)];
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

function chunkPreviewCaptionText(value: string, maxCharacters = 36) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxCharacters) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function getPreviewCaptionText(composition: Composition, sourceVideo: UploadedVideo | null, playheadMs: number) {
  const settings = getCaptionSettings(composition.captionSettings);
  if (settings.mode === 'none') {
    return '';
  }

  if (settings.mode === 'manual') {
    const chunks = chunkPreviewCaptionText(settings.manualText || '');
    if (chunks.length === 0) {
      return '';
    }

    const slotDuration = Math.max(composition.durationMs, 1000) / chunks.length;
    return chunks[Math.min(chunks.length - 1, Math.floor(playheadMs / slotDuration))] || '';
  }

  const currentTrack = composition.captionTrack;
  if (currentTrack) {
    if (settings.displayMode === 'word') {
      return (currentTrack.words || [])
        .filter((word) => playheadMs >= word.startMs && playheadMs <= word.endMs)
        .map((word) => word.text)
        .join(' ');
    }

    return (currentTrack.cues || [])
      .filter((cue) => playheadMs >= cue.startMs && playheadMs <= cue.endMs)
      .map((cue) => cue.text)
      .join(' ');
  }

  const videoItem = getVideoItems(composition)[0];
  const sourceTimeMs = (videoItem?.sourceInMs || 0) + Math.max(0, playheadMs - (videoItem?.timelineStartMs || 0));
  const sourceSegments = sourceVideo?.analysis?.tools?.whisperx?.segments || [];
  const segments = sourceSegments
    .map((segment) => {
      if (!segment || typeof segment !== 'object') {
        return null;
      }

      const value = segment as { start?: unknown; end?: unknown; text?: unknown; words?: unknown[] };
      const startMs = Number(value.start) * 1000;
      const endMs = Number(value.end) * 1000;
      return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? { startMs, endMs, text: String(value.text || ''), words: value.words || [] }
        : null;
    })
    .filter((segment): segment is { startMs: number; endMs: number; text: string; words: unknown[] } => Boolean(segment));
  const activeSegment = segments.find((segment) => sourceTimeMs >= segment.startMs && sourceTimeMs <= segment.endMs);

  if (!activeSegment) {
    return '';
  }

  if (settings.displayMode === 'word') {
    const word = activeSegment.words
      .map((value) => value as { start?: unknown; end?: unknown; word?: unknown; text?: unknown })
      .find((value) => sourceTimeMs >= Number(value.start) * 1000 && sourceTimeMs <= Number(value.end) * 1000);
    return word ? String(word.word || word.text || '') : '';
  }

  return activeSegment.text;
}

function getRatioLabel(width: number, height: number) {
  const divisor = (a: number, b: number): number => (b === 0 ? a : divisor(b, a % b));
  const gcd = divisor(Math.round(width), Math.round(height));
  return `${Math.round(width / gcd)}:${Math.round(height / gcd)}`;
}

function getObjectPosition(value: number) {
  return `${clamp(50 + value / 2, 0, 100)}%`;
}

function getTrackedPosition(composition: Composition, playheadMs: number) {
  const keyframes = (composition.framingTrack || [])
    .filter((keyframe) => Number.isFinite(Number(keyframe.timeMs)))
    .sort((first, second) => first.timeMs - second.timeMs);
  if (keyframes.length === 0) {
    return null;
  }

  if (playheadMs <= keyframes[0].timeMs) {
    return keyframes[0];
  }

  const lastKeyframe = keyframes[keyframes.length - 1];
  if (playheadMs >= lastKeyframe.timeMs) {
    return lastKeyframe;
  }

  const nextIndex = keyframes.findIndex((keyframe) => keyframe.timeMs >= playheadMs);
  const next = keyframes[nextIndex];
  const previous = keyframes[Math.max(0, nextIndex - 1)];
  const progress = (playheadMs - previous.timeMs) / Math.max(next.timeMs - previous.timeMs, 1);
  return {
    ...previous,
    x: previous.x + (next.x - previous.x) * progress,
    y: previous.y + (next.y - previous.y) * progress,
  };
}

function getVisualStyle(
  composition: Composition,
  item: TrackItem,
  dragPreview: { itemId: string; x: number; y: number } | null,
  playheadMs = 0,
): CSSProperties {
  const region = getCompositionRegion(composition, item);
  const baseTransform = getTransform(item);
  const trackedPosition = item.mediaType === 'image' ? null : getTrackedPosition(composition, playheadMs);
  const transform = dragPreview?.itemId === item.id
    ? { ...baseTransform, x: dragPreview.x, y: dragPreview.y }
    : trackedPosition
      ? {
          ...baseTransform,
          x: clamp(baseTransform.x + trackedPosition.x, -100, 100),
          y: clamp(baseTransform.y + trackedPosition.y, -100, 100),
        }
      : baseTransform;
  const isImage = item.mediaType === 'image';
  const left = isImage ? region.xPct + (region.widthPct * transform.x) / 200 : region.xPct;
  const top = isImage ? region.yPct + (region.heightPct * transform.y) / 200 : region.yPct;

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${region.widthPct}%`,
    height: `${region.heightPct}%`,
    objectFit: transform.cropMode === 'contain' ? 'contain' : 'cover',
    objectPosition: isImage ? '50% 50%' : `${getObjectPosition(transform.x)} ${getObjectPosition(transform.y)}`,
    transform: `scale(${transform.scale}) rotate(${transform.rotation || 0}deg)`,
  };
}

export function CompositionEditorPage() {
  const { projectId, clipId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Awaited<ReturnType<typeof getProject>> | null>(null);
  const [sourceVideo, setSourceVideo] = useState<UploadedVideo | null>(null);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingClips, setIsGeneratingClips] = useState(false);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [isApprovingSelected, setIsApprovingSelected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragPreview, setDragPreview] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const [captionPositionPreview, setCaptionPositionPreview] = useState<{ x: number; y: number } | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isRemovingImageId, setIsRemovingImageId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const latestCompositionRef = useRef<Composition | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    itemId: string;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);
  const captionDragRef = useRef<{
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
    Promise.all([getProject(projectId), listUploadedVideos()])
      .then(([loadedProject, videos]) => {
        if (!isCurrent) {
          return;
        }

        const selectedComposition =
          loadedProject.compositions.find((composition) => composition.id === clipId) ||
          loadedProject.compositions[0];

        setProject(loadedProject);
        setSourceVideo(videos.find((video) => video.id === loadedProject.sourceVideoId) || null);
        setCaptionPositionPreview(null);
        captionDragRef.current = null;
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
  const selectableProposalIds = project?.compositions
    .filter((proposal) => proposal.status !== 'approved')
    .map((proposal) => proposal.id) || [];
  const selectedProposalCount = selectableProposalIds.filter((proposalId) => selectedProposalIds.has(proposalId)).length;
  const allProposalsSelected = selectableProposalIds.length > 0 && selectedProposalCount === selectableProposalIds.length;
  const captionSettings = composition
    ? getCaptionSettings(composition.captionSettings)
    : DEFAULT_CAPTION_SETTINGS;
  const items = useMemo(() => getVideoItems(composition), [composition]);
  const mediaItems = useMemo(() => getMediaItems(composition), [composition]);
  const visualItems = useMemo(() => getVisualItems(composition), [composition]);
  const selectedItem = visualItems.find((item) => item.id === state.selectedItemId) || visualItems[0] || null;
  const playbackVideoItem = items.find((item) => item.id === state.selectedItemId) || items[0] || null;
  const sourceAsset = project?.assets.find((asset) => asset.id === selectedItem?.assetId) || project?.assets.find((asset) => asset.type === 'video') || project?.assets[0];
  const playbackAsset = project?.assets.find((asset) => asset.id === playbackVideoItem?.assetId) || project?.assets.find((asset) => asset.type === 'video');
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
  const videoStyle: CSSProperties = composition && playbackVideoItem
    ? getVisualStyle(composition, playbackVideoItem, dragPreview, state.playheadMs)
    : {};
  const regionFrameStyle: CSSProperties = selectedRegion
    ? {
        left: `${selectedRegion.xPct}%`,
        top: `${selectedRegion.yPct}%`,
        width: `${selectedRegion.widthPct}%`,
        height: `${selectedRegion.heightPct}%`,
      }
    : {};
  const previewCaptionText = composition
    ? getPreviewCaptionText(composition, sourceVideo, state.playheadMs)
    : '';
  const captionPosition = captionPositionPreview || {
    x: captionSettings.positionX ?? 50,
    y: captionSettings.positionY ?? 86,
  };
  const previewCaptionStyle: CSSProperties = {
    left: `${captionPosition.x}%`,
    top: `${captionPosition.y}%`,
    width: captionSettings.displayMode === 'word' ? 'auto' : `${captionSettings.maxWidthPct}%`,
    transform: 'translate(-50%, -50%)',
    color: captionSettings.displayMode === 'word' ? captionSettings.highlightColor : captionSettings.textColor,
    backgroundColor: getCaptionBackgroundColor(captionSettings),
    fontSize: `${Math.max(12, Number(captionSettings.fontSize || 42) * 0.42)}px`,
    textShadow: `0 1px 2px ${captionSettings.outlineColor}, 0 2px 8px ${captionSettings.outlineColor}`,
    outline: `${Math.max(0, Number(captionSettings.outlineWidth || 0)) * 0.5}px solid ${captionSettings.outlineColor}`,
  };

  useEffect(() => {
    latestCompositionRef.current = composition;
  }, [composition]);

  const seekToPlayhead = useCallback((playheadMs: number) => {
    const video = videoRef.current;
    const videoItems = latestCompositionRef.current?.tracks.find((track) => track.kind === 'video')?.items || [];
    const item = videoItems.find((currentItem) => currentItem.id === state.selectedItemId) || videoItems[0];

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

  function toggleProposalSelection(proposalId: string) {
    setSelectedProposalIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(proposalId)) {
        nextIds.delete(proposalId);
      } else {
        nextIds.add(proposalId);
      }
      return nextIds;
    });
  }

  function toggleAllProposals() {
    setSelectedProposalIds(allProposalsSelected ? new Set() : new Set(selectableProposalIds));
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || !playbackVideoItem) {
      return;
    }

    const sourceTimeMs = Math.round(video.currentTime * 1000);
    const nextPlayhead = playbackVideoItem.timelineStartMs + sourceTimeMs - playbackVideoItem.sourceInMs;
    dispatch({ type: 'set-playhead', playheadMs: nextPlayhead });

    if (sourceTimeMs >= playbackVideoItem.sourceOutMs) {
      video.pause();
      setIsPlaying(false);
      dispatch({
        type: 'set-playhead',
        playheadMs: playbackVideoItem.timelineStartMs + getItemDuration(playbackVideoItem),
      });
    }
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !playbackVideoItem) {
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

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || !project) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Selecione uma imagem válida.');
      return;
    }

    try {
      setIsUploadingImage(true);
      setError('');
      if (state.isDirty && !(await persistComposition())) {
        return;
      }

      const result = await uploadProjectImage(project.id, file, { addToLayout: true });
      setProject(result.project);
      const updatedComposition = result.project.compositions.find((currentComposition) => currentComposition.id === composition?.id);
      const addedImage = updatedComposition
        ? getMediaItems(updatedComposition).find((item) => item.assetId === result.asset.id)
        : null;

      if (updatedComposition) {
        dispatch({ type: 'load', composition: updatedComposition });
        if (addedImage) {
          dispatch({ type: 'select-item', itemId: addedImage.id });
        }
      }

      setMessage('Imagem adicionada ao layout compartilhado.');
    } catch {
      setError('Nao foi possivel adicionar a imagem ao projeto.');
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function handleImageRemove(assetId: string) {
    if (!project || !assetId || isRemovingImageId) {
      return;
    }

    const savedComposition = state.isDirty ? await persistComposition() : composition;
    if (!savedComposition) {
      return;
    }

    try {
      setIsRemovingImageId(assetId);
      setError('');
      const updatedProject = await deleteProjectImage(project.id, assetId);
      const updatedComposition = updatedProject.compositions.find((currentComposition) => currentComposition.id === savedComposition.id);

      setProject(updatedProject);
      if (updatedComposition) {
        dispatch({ type: 'load', composition: updatedComposition });
      }
      setMessage('Imagem removida do layout compartilhado.');
    } catch {
      setError('Nao foi possivel remover a imagem do projeto.');
    } finally {
      setIsRemovingImageId(null);
    }
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const targetElement = event.target instanceof HTMLElement ? event.target : null;
    if (targetElement?.closest('.composition-caption-overlay') && captionSettings.mode !== 'none') {
      event.currentTarget.setPointerCapture(event.pointerId);
      captionDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        initialX: captionPosition.x,
        initialY: captionPosition.y,
      };
      setCaptionPositionPreview(captionPosition);
      return;
    }

    const targetItemId = targetElement?.closest<HTMLElement>('[data-composition-item-id]')?.dataset.compositionItemId;
    const dragItem = visualItems.find((item) => item.id === targetItemId) || selectedItem;

    if (!dragItem) {
      return;
    }

    if (dragItem.id !== selectedItem?.id) {
      dispatch({ type: 'select-item', itemId: dragItem.id });
    }

    const dragTransform = getTransform(dragItem);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      itemId: dragItem.id,
      startX: event.clientX,
      startY: event.clientY,
      initialX: dragTransform.x,
      initialY: dragTransform.y,
    };
    setDragPreview({ itemId: dragItem.id, x: dragTransform.x, y: dragTransform.y });
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const captionDrag = captionDragRef.current;
    if (captionDrag && captionDrag.pointerId === event.pointerId) {
      const bounds = event.currentTarget.getBoundingClientRect();
      setCaptionPositionPreview({
        x: clamp(captionDrag.initialX + ((event.clientX - captionDrag.startX) / bounds.width) * 100, 5, 95),
        y: clamp(captionDrag.initialY + ((event.clientY - captionDrag.startY) / bounds.height) * 100, 5, 95),
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    setDragPreview({
      itemId: drag.itemId,
      x: clamp(drag.initialX + ((event.clientX - drag.startX) / bounds.width) * 200, -100, 100),
      y: clamp(drag.initialY + ((event.clientY - drag.startY) / bounds.height) * 200, -100, 100),
    });
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const captionDrag = captionDragRef.current;
    if (captionDrag && captionDrag.pointerId === event.pointerId) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = clamp(captionDrag.initialX + ((event.clientX - captionDrag.startX) / bounds.width) * 100, 5, 95);
      const y = clamp(captionDrag.initialY + ((event.clientY - captionDrag.startY) / bounds.height) * 100, 5, 95);
      dispatch({ type: 'update-caption-settings', settings: { positionX: x, positionY: y } });
      captionDragRef.current = null;
      setCaptionPositionPreview(null);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = clamp(drag.initialX + ((event.clientX - drag.startX) / bounds.width) * 200, -100, 100);
    const y = clamp(drag.initialY + ((event.clientY - drag.startY) / bounds.height) * 200, -100, 100);
    dispatch({ type: 'update-transform', itemId: drag.itemId, transform: { x, y } });
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
      setSelectedProposalIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(result.composition.id);
        return nextIds;
      });
      dispatch({ type: 'mark-saved', composition: result.composition });
      setMessage('Corte aprovado para exportacao.');
    } catch {
      setError('Nao foi possivel aprovar o corte.');
    }
  }

  async function approveSelectedProposals() {
    if (!project || !composition || selectedProposalCount === 0 || isApprovingSelected) {
      return;
    }

    const selectedIds = new Set(
      selectableProposalIds.filter((proposalId) => selectedProposalIds.has(proposalId)),
    );
    const savedComposition = state.isDirty ? await persistComposition() : composition;
    if (!savedComposition) {
      return;
    }

    let latestProject = project;
    if (state.isDirty) {
      latestProject = {
        ...project,
        compositions: project.compositions.map((currentComposition) =>
          currentComposition.id === savedComposition.id ? savedComposition : currentComposition,
        ),
        updatedAt: savedComposition.updatedAt,
      };
    }

    const compositionsToApprove = latestProject.compositions.filter(
      (currentComposition) => selectedIds.has(currentComposition.id) && currentComposition.status !== 'approved',
    );

    if (compositionsToApprove.length === 0) {
      setSelectedProposalIds(new Set());
      return;
    }

    try {
      setIsApprovingSelected(true);
      setError('');
      setMessage('');

      for (const currentComposition of compositionsToApprove) {
        const result = await approveComposition(currentComposition);
        latestProject = result.project;
      }

      setProject(latestProject);
      setSelectedProposalIds(new Set());
      const updatedCurrentComposition = latestProject.compositions.find(
        (currentComposition) => currentComposition.id === composition.id,
      );
      if (updatedCurrentComposition && selectedIds.has(updatedCurrentComposition.id)) {
        dispatch({ type: 'mark-saved', composition: updatedCurrentComposition });
      }
      setMessage(`${compositionsToApprove.length} cortes aprovados para exportacao.`);
    } catch (error) {
      setProject(latestProject);
      setSelectedProposalIds(new Set(
        latestProject.compositions
          .filter((currentComposition) => selectedIds.has(currentComposition.id) && currentComposition.status !== 'approved')
          .map((currentComposition) => currentComposition.id),
      ));
      setError(error instanceof Error ? error.message : 'Nao foi possivel aprovar os cortes selecionados.');
    } finally {
      setIsApprovingSelected(false);
    }
  }

  async function generateCutsFromLayout() {
    if (isGeneratingClips || isSaving || !composition || !project || !project.isLayoutDraft) {
      return;
    }

    const currentProjectId = project.id;

    try {
      setIsGeneratingClips(true);
      setError('');
      setMessage('Salvando o layout e preparando a geração dos cortes...');
      const savedComposition = state.isDirty ? await persistComposition() : composition;
      if (!savedComposition) {
        return;
      }

      setMessage('Gerando cortes e preparando-os para revisão. Isso pode levar alguns instantes...');
      const generatedProject = await generateProjectClips(currentProjectId);
      const firstComposition = generatedProject.compositions[0];
      setProject(generatedProject);
      setSelectedProposalIds(new Set());

      if (firstComposition) {
        dispatch({ type: 'load', composition: firstComposition });
        navigate(`/projetos/${generatedProject.id}/cortes/${firstComposition.id}/editor`, { replace: true });
      }

      setMessage('Layout salvo. Cortes gerados para revisão.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Nao foi possivel gerar os cortes a partir deste layout.');
    } finally {
      setIsGeneratingClips(false);
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
          {project.isLayoutDraft ? (
            <button className="composition-next" type="button" aria-busy={isSaving || isGeneratingClips} disabled={isSaving || isGeneratingClips} onClick={() => void generateCutsFromLayout()}>
              {isGeneratingClips ? <LoaderCircle className="composition-generation-spinner" size={16} /> : <Scissors size={16} />}
              {isGeneratingClips ? 'Gerando cortes...' : isSaving ? 'Salvando layout...' : 'Salvar layout e gerar cortes'}
            </button>
          ) : (
            <button className="composition-approve" type="button" disabled={isSaving || composition.status === 'approved'} onClick={() => void approveCurrentComposition()}>
              <Check size={16} />
              Aprovar corte
            </button>
          )}
          {composition.status === 'approved' && (
            <button className="composition-next" type="button" onClick={() => navigate(`/legendas?projectId=${project.id}`)}>
              <Subtitles size={16} />
              Produzir legenda
            </button>
          )}
        </div>
      </header>

      {isGeneratingClips && (
        <div className="composition-generation-status" role="status" aria-live="polite">
          <LoaderCircle className="composition-generation-spinner" size={19} />
          <div>
            <strong>{isSaving ? 'Salvando o layout...' : 'Gerando cortes...'}</strong>
            <span>{isSaving ? 'Aguarde enquanto as alterações são salvas.' : 'O ClipCut está criando os cortes e preparando-os para revisão. Não feche esta janela.'}</span>
          </div>
        </div>
      )}

      {!project.isLayoutDraft && !isGeneratingClips && (
        <div className={`composition-generation-result${project.generationWarning ? ' has-warning' : ''}`} role="status">
          {project.generationWarning ? <CircleAlert size={18} /> : <Check size={18} />}
          <div>
            {project.generationWarning && <span className="composition-generation-warning">{project.generationWarning}</span>}
            <strong>{project.compositions.length} {project.compositions.length === 1 ? 'corte gerado' : 'cortes gerados'} e salvos</strong>
            <span>Os cortes estão prontos para revisão. A exportação dos arquivos MP4 acontece depois, na Galeria.</span>
          </div>
        </div>
      )}

      <section className="composition-workspace">
        <aside className="composition-panel proposal-panel">
          <div className="composition-panel-heading">
            <div>
              <span className="composition-eyebrow">Rascunhos</span>
              <h2>{project.isLayoutDraft ? 'Layout base' : 'Cortes sugeridos'}</h2>
            </div>
            <span>{project.compositions.length}</span>
          </div>
          {!project.isLayoutDraft && (
            <div className="proposal-selection-toolbar" aria-label="Selecao de cortes">
              <label className="proposal-select-all">
                <input
                  type="checkbox"
                  checked={allProposalsSelected}
                  disabled={selectableProposalIds.length === 0 || isApprovingSelected}
                  onChange={toggleAllProposals}
                />
                <span>Selecionar todos</span>
              </label>
              {selectedProposalCount > 0 && (
                <button
                  className="proposal-bulk-approve"
                  type="button"
                  disabled={isApprovingSelected || isSaving}
                  onClick={() => void approveSelectedProposals()}
                >
                  <Check size={15} />
                  {isApprovingSelected ? 'Aprovando...' : `Aprovar selecionados (${selectedProposalCount})`}
                </button>
              )}
            </div>
          )}
          <div className="proposal-list">
            {project.compositions.map((proposal) => (
              <div
                className={`proposal-card-row ${selectedProposalIds.has(proposal.id) ? 'is-selected' : ''}`}
                key={proposal.id}
              >
                <button
                  className={`proposal-card ${proposal.id === composition.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => selectComposition(proposal)}
                >
                  <span>{proposal.title}</span>
                <small>{formatTime(proposal.durationMs)} · {formatStatus(proposal.status)}</small>
                </button>
                {!project.isLayoutDraft && (
                  <label className="proposal-selection-checkbox">
                    <input
                      type="checkbox"
                      checked={proposal.status !== 'approved' && selectedProposalIds.has(proposal.id)}
                      disabled={proposal.status === 'approved' || isApprovingSelected}
                      onChange={() => toggleProposalSelection(proposal.id)}
                      aria-label={`Selecionar ${proposal.title}`}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="proposal-help">
            <Scissors size={17} />
            <p>{project.isLayoutDraft ? 'Edite este layout com o vídeo inteiro. Ao gerar os cortes, o formato e as imagens serão copiados para todos eles.' : 'Formato, fundo e imagens são compartilhados por todos os cortes. Ajuste apenas o intervalo e o enquadramento do vídeo quando trocar de corte.'}</p>
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
            {playbackAsset && (
              <video
                ref={videoRef}
                data-composition-item-id={playbackVideoItem.id}
                src={playbackAsset.url}
                style={videoStyle}
                preload="metadata"
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            )}
            {composition && mediaItems.map((item) => {
              const asset = project?.assets.find((currentAsset) => currentAsset.id === item.assetId);
              if (!asset) {
                return null;
              }

              return (
                <img
                  key={item.id}
                  data-composition-item-id={item.id}
                  className={`composition-media-image ${item.id === selectedItem?.id ? 'selected' : ''}`}
                  src={asset.url}
                  alt={asset.name}
                  draggable={false}
                  style={getVisualStyle(composition, item, dragPreview)}
                  onClick={() => dispatch({ type: 'select-item', itemId: item.id })}
                />
              );
            })}
            {captionSettings.mode !== 'none' && previewCaptionText && (
              <div
                className={`composition-caption-overlay ${captionSettings.displayMode === 'word' ? 'word' : ''}`}
                style={{ ...previewCaptionStyle, fontFamily: getSubtitleFont(captionSettings.font || 'geist').cssFamily }}
                aria-label="Prévia da legenda"
              >
                {previewCaptionText}
              </div>
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

          <div className="inspector-section caption-section">
            <div className="inspector-section-title">
              <Subtitles size={15} />
              <span className="inspector-label">Legenda na edição</span>
            </div>
            <label>
              Modo da legenda
              <select
                value={captionSettings.mode}
                onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { mode: event.target.value as CaptionSettings['mode'] } })}
              >
                <option value="automatic">Automática</option>
                <option value="manual">Manual</option>
                <option value="none">Sem legenda</option>
              </select>
            </label>
            {captionSettings.mode === 'manual' && (
              <label>
                Texto da legenda
                <textarea
                  value={captionSettings.manualText || ''}
                  rows={4}
                  placeholder="Digite a legenda que será exibida no vídeo"
                  onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { manualText: event.target.value } })}
                />
              </label>
            )}
            <div className="inspector-fields">
              <label>
                Posição
                <select
                  value={captionSettings.position}
                  disabled={captionSettings.mode === 'none'}
                  onChange={(event) => {
                    const position = event.target.value as CaptionSettings['position'];
                    dispatch({
                      type: 'update-caption-settings',
                      settings: {
                        position,
                        positionX: 50,
                        positionY: position === 'top' ? 12 : position === 'middle' ? 50 : 86,
                      },
                    });
                  }}
                >
                  <option value="top">Superior</option>
                  <option value="middle">Centro</option>
                  <option value="bottom">Inferior</option>
                </select>
              </label>
              <label>
                Exibição
                <select
                  value={captionSettings.displayMode}
                  disabled={captionSettings.mode === 'none'}
                  onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { displayMode: event.target.value as CaptionSettings['displayMode'] } })}
                >
                  <option value="block">Em blocos</option>
                  <option value="word">Palavra a palavra</option>
                </select>
              </label>
            </div>
            <label>
              Idioma
              <select
                value={captionSettings.language}
                disabled={captionSettings.mode === 'none'}
                onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { language: event.target.value as CaptionSettings['language'] } })}
              >
                <option value="pt-BR">Português traduzido</option>
                <option value="original">Idioma original</option>
              </select>
            </label>
            <div className="inspector-fields caption-style-fields">
              <label className="range-field">
                <span>Tamanho <strong>{Math.round(captionSettings.fontSize || 42)} px</strong></span>
                <input type="range" min="24" max="96" step="1" value={captionSettings.fontSize || 42} disabled={captionSettings.mode === 'none'} onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { fontSize: Number(event.target.value) } })} />
              </label>
              <label className="range-field">
                <span>Largura <strong>{Math.round(captionSettings.maxWidthPct || 84)}%</strong></span>
                <input type="range" min="35" max="95" step="1" value={captionSettings.maxWidthPct || 84} disabled={captionSettings.mode === 'none'} onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { maxWidthPct: Number(event.target.value) } })} />
              </label>
            </div>
            <div className="inspector-inline-fields caption-color-fields">
              <label className="color-field">
                Texto
                <input type="color" value={captionSettings.textColor || '#FFFFFF'} disabled={captionSettings.mode === 'none'} onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { textColor: event.target.value } })} />
              </label>
              <label className="color-field">
                Palavra ativa
                <input type="color" value={captionSettings.highlightColor || '#73DDBD'} disabled={captionSettings.mode === 'none'} onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { highlightColor: event.target.value } })} />
              </label>
              <label className="color-field">
                Fundo
                <input type="color" value={captionSettings.backgroundColor || '#000000'} disabled={captionSettings.mode === 'none'} onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { backgroundColor: event.target.value } })} />
              </label>
            </div>
            <label className="range-field">
              <span>Opacidade do fundo <strong>{Math.round(Number(captionSettings.backgroundOpacity || 0) * 100)}%</strong></span>
              <input type="range" min="0" max="1" step="0.05" value={captionSettings.backgroundOpacity ?? 0.6} disabled={captionSettings.mode === 'none'} onChange={(event) => dispatch({ type: 'update-caption-settings', settings: { backgroundOpacity: Number(event.target.value) } })} />
            </label>
            <p className="inspector-muted">
              A legenda é preparada ao salvar este layout, antes da geração dos cortes, e sempre fica acima das imagens.
            </p>
            {!composition.captionTrack && captionSettings.mode === 'automatic' && !sourceVideo?.analysis?.tools?.whisperx?.segments?.length && (
              <p className="inspector-warning">A análise de voz ainda não está disponível para mostrar a prévia.</p>
            )}
          </div>

          <div className="inspector-section media-section">
            <div className="inspector-section-title">
              <ImagePlus size={15} />
              <span className="inspector-label">Imagens do layout</span>
            </div>
            <label className="image-upload-button">
              <ImagePlus size={15} />
              {isUploadingImage ? 'Enviando imagem...' : 'Adicionar imagem'}
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleImageUpload} disabled={isUploadingImage} />
            </label>
            {mediaItems.length > 0 ? (
              <div className="media-item-list">
                {mediaItems.map((item) => {
                  const asset = project.assets.find((currentAsset) => currentAsset.id === item.assetId);
                  return (
                    <div className="media-item-row" key={item.id}>
                      <button className={`media-item-button ${item.id === selectedItem?.id ? 'active' : ''}`} type="button" onClick={() => dispatch({ type: 'select-item', itemId: item.id })}>
                        <span>{asset?.name || 'Imagem do projeto'}</span>
                        <small>Selecionar</small>
                      </button>
                      <button
                        className="media-item-remove"
                        type="button"
                        title="Remover imagem"
                        aria-label={`Remover ${asset?.name || 'imagem'}`}
                        disabled={isRemovingImageId === item.assetId}
                        onClick={() => void handleImageRemove(item.assetId)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="inspector-muted">Adicione uma marca, moldura ou imagem de apoio. Ela será replicada em todos os cortes.</p>
            )}
            <p className="inspector-muted">O canvas e as imagens são compartilhados; ajuste apenas o enquadramento do vídeo em cada corte.</p>
          </div>

          {selectedItem && (
            <>
              {selectedItem.mediaType !== 'image' && <div className="inspector-section">
                <span className="inspector-label">Intervalo do trecho</span>
                <div className="inspector-fields">
                  <label>
                    Inicio (s)
                    <input type="number" min="0" max={Math.max(0, (selectedItem.sourceOutMs - MIN_CLIP_DURATION_MS) / 1000)} step="0.1" value={(selectedItem.sourceInMs / 1000).toFixed(1)} onChange={(event) => updateTrim('start', event.target.value)} />
                  </label>
                  <label>
                    Fim (s)
                    <input type="number" min={(selectedItem.sourceInMs + MIN_CLIP_DURATION_MS) / 1000} step="0.1" value={(selectedItem.sourceOutMs / 1000).toFixed(1)} onChange={(event) => updateTrim('end', event.target.value)} />
                  </label>
                </div>
                <p className="inspector-muted">Cada segmento precisa ter pelo menos 1 minuto · {formatTime(getItemDuration(selectedItem))}</p>
              </div>}

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
                  <input type="range" min={selectedItem.mediaType === 'image' ? '0.1' : '0.5'} max="3" step="0.01" value={visibleTransform.scale} onChange={(event) => updateTransform('scale', event.target.value)} />
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

              {selectedItem.mediaType !== 'image' && <div className="inspector-section inspector-actions">
                <span className="inspector-label">Comandos reversiveis</span>
                <button
                  type="button"
                  disabled={getItemDuration(selectedItem) < MIN_CLIP_DURATION_MS * 2}
                  onClick={() => dispatch({ type: 'split-item', itemId: selectedItem.id, splitAtMs: state.playheadMs })}
                >
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
              </div>}

              {selectedItem.mediaType !== 'image' && <div className="inspector-section inspector-actions">
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
              </div>}
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
