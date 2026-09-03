import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowRight, Bot, FileVideo2, ImagePlus, Maximize2, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  analyzeUploadedVideo,
  createProject,
  deleteUploadedVideo,
  getAiStatus,
  listUploadedVideos,
  uploadProjectImage,
  UploadedVideo,
} from '../../lib/videoApi';
import { Header } from '../main/Header';
import { NewClipButton } from '../new-clip/NewClipButton';
import { StepIndicator } from '../ui';
import type { CanvasPreset, LayoutConfig } from '../../features/editor/domain/editor.types';
import { getLayoutPreset, LAYOUT_PRESETS } from '../../features/editor/domain/layout';
import { formatDuration, formatFileSize } from '../../lib/formatters';
import './page.css';

function createLayoutConfig(preset: CanvasPreset): LayoutConfig {
  const definition = getLayoutPreset(preset);
  return {
    canvas: {
      width: definition.width,
      height: definition.height,
      fps: 30,
    },
    layout: {
      id: `${preset}-main`,
      name: definition.label,
      preset,
      background: '#05050a',
      showSafeArea: true,
      regions: [
        {
          id: 'main',
          name: 'Video principal',
          xPct: 0,
          yPct: 0,
          widthPct: 100,
          heightPct: 100,
          visible: true,
        },
      ],
    },
  };
}

type LayoutImageDraft = {
  file: File;
  previewUrl: string;
};

const AI_STATUS_ITEMS = [
  { key: 'python', label: 'Python', optional: false },
  { key: 'ffmpeg', label: 'ffmpeg', optional: false },
  { key: 'whisperx', label: 'WhisperX', optional: false },
  { key: 'mediapipe', label: 'MediaPipe', optional: false },
  { key: 'pyannote', label: 'Pyannote', optional: false },
  { key: 'pyannoteToken', label: 'Token Pyannote', optional: false },
  { key: 'ollama', label: 'Ollama', optional: true },
] as const;

export function FilesPage() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<UploadedVideo | null>(null);
  const [layoutVideo, setLayoutVideo] = useState<UploadedVideo | null>(null);
  const [layoutPreset, setLayoutPreset] = useState<CanvasPreset>('vertical');
  const [layoutImages, setLayoutImages] = useState<LayoutImageDraft[]>([]);
  const [processingVideoId, setProcessingVideoId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ videoId: string; progress: number } | null>(null);
  const [preparingVideoId, setPreparingVideoId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<Record<string, boolean> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  function loadVideos() {
    setIsLoading(true);
    setError('');
    listUploadedVideos()
      .then(setVideos)
      .catch(() => setError('Nao foi possivel carregar os videos da API local.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadVideos();
    getAiStatus().then(setAiStatus).catch(() => setAiStatus(null));
  }, []);

  async function deleteVideo(videoId: string) {
    try {
      await deleteUploadedVideo(videoId);
      setVideos((currentVideos) => currentVideos.filter((video) => video.id !== videoId));
      setSelectedVideo((currentVideo) => (currentVideo?.id === videoId ? null : currentVideo));
    } catch {
      setError('Nao foi possivel apagar o video.');
    }
  }

  function openLayoutSetup(video: UploadedVideo) {
    setSelectedVideo(null);
    setLayoutVideo(video);
    setLayoutPreset('vertical');
    clearLayoutImages();
    setError('');
  }

  function clearLayoutImages() {
    setLayoutImages((currentImages) => {
      currentImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  }

  function closeLayoutSetup() {
    setLayoutVideo(null);
    clearLayoutImages();
  }

  function addLayoutImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length !== files.length) {
      setError('Apenas arquivos de imagem podem entrar no layout.');
    }

    if (imageFiles.length === 0) {
      return;
    }

    setLayoutImages((currentImages) => [
      ...currentImages,
      ...imageFiles.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeLayoutImage(index: number) {
    setLayoutImages((currentImages) => {
      const image = currentImages[index];
      if (image) {
        URL.revokeObjectURL(image.previewUrl);
      }
      return currentImages.filter((_currentImage, imageIndex) => imageIndex !== index);
    });
  }

  async function startLayout() {
    if (!layoutVideo) {
      return;
    }

    const video = layoutVideo;
    try {
      setPreparingVideoId(video.id);
      setError('');

      const project = await createProject({
        videoId: video.id,
        clipIds: [],
        layout: createLayoutConfig(layoutPreset),
        layoutOnly: true,
      });
      let initializedProject = project;
      for (const image of layoutImages) {
        const result = await uploadProjectImage(project.id, image.file, { addToLayout: true });
        initializedProject = result.project;
      }

      const firstComposition = initializedProject.compositions[0];

      if (!firstComposition) {
        throw new Error('EMPTY_PROJECT');
      }

      closeLayoutSetup();
      navigate(`/projetos/${initializedProject.id}/cortes/${firstComposition.id}/editor`);
    } catch {
      setError('Nao foi possivel preparar os cortes para edição.');
    } finally {
      setPreparingVideoId(null);
    }
  }

  async function analyzeVideo(videoId: string) {
    try {
      setProcessingVideoId(videoId);
      const updatedVideo = await analyzeUploadedVideo(videoId, (job) => {
        setAnalysisProgress({ videoId, progress: job.progress });
      });
      setVideos((currentVideos) =>
        currentVideos.map((video) => (video.id === videoId ? updatedVideo : video)),
      );
      setSelectedVideo((currentVideo) => (currentVideo?.id === videoId ? updatedVideo : currentVideo));
    } catch {
      setError('Nao foi possivel executar a analise de IA.');
    } finally {
      setProcessingVideoId(null);
      setAnalysisProgress(null);
    }
  }

  function renderAnalysis(video: UploadedVideo) {
    const analysis = video.analysis;

    if (!analysis) {
      return null;
    }

    const tools = analysis.tools || {};
    const ollamaText = tools.ollama?.response;
    const transcript = tools.whisperx?.text;

    return (
      <div className="ai-result">
        <div className="ai-tool-grid">
          {['ffmpeg', 'whisperx', 'mediapipe', 'pyannote', 'ollama'].map((toolName) => {
            const tool = tools[toolName as keyof typeof tools];
            const isOk = tool?.ok === true;
            const isUnavailable = tool?.available === false;

            return (
              <span className={`ai-tool ${isOk ? 'ok' : isUnavailable ? 'missing' : 'warn'}`} key={toolName}>
                {toolName}
              </span>
            );
          })}
        </div>

        {transcript && (
          <div className="ai-text-block">
            <strong>Transcricao WhisperX</strong>
            <p>{transcript}</p>
          </div>
        )}

        {ollamaText && (
          <div className="ai-text-block">
            <strong>Resumo Ollama</strong>
            <p>{ollamaText}</p>
          </div>
        )}

        {tools.mediapipe?.ok && (
          <div className="ai-text-block">
            <strong>MediaPipe</strong>
            <p>
              {tools.mediapipe.framesWithFaces || 0} frames com rosto de {tools.mediapipe.sampledFrames || 0}{' '}
              amostras.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="files-heading">
          <div>
            <p className="eyebrow">Etapa 1 de 6</p>
            <h1>Armazenar vídeo</h1>
            <p>Envie e mantenha os vídeos disponíveis para iniciar um novo fluxo de cortes.</p>
          </div>
          <div className="files-heading-actions">
            <span>{videos.length} videos salvos</span>
            <NewClipButton onUploaded={loadVideos} />
          </div>
        </div>

        <StepIndicator currentStep={1} />

        {aiStatus && (
          <div className="ai-status-panel">
            {AI_STATUS_ITEMS.map(({ key, label, optional }) => {
              const isReady = aiStatus[key] === true;
              return (
                <span className={isReady ? 'ready' : 'missing'} key={key}>
                  {label}: {isReady ? 'ok' : optional ? 'opcional' : 'não disponível'}
                </span>
              );
            })}
          </div>
        )}

        {isLoading && <div className="route-panel">Carregando videos...</div>}

        {error && <div className="route-panel files-empty">{error}</div>}

        {!isLoading && !error && videos.length === 0 && (
          <div className="route-panel files-empty">
            <FileVideo2 size={34} />
            <h2>Nenhum video enviado</h2>
            <p>Use Novo clip para armazenar um vídeo. Depois prepare os cortes e siga para Editar layout.</p>
          </div>
        )}

        {!isLoading && !error && videos.length > 0 && (
          <div className="files-grid">
            {videos.map((video) => (
              <article className="video-card" key={video.id}>
                <button
                  className="video-thumbnail"
                  type="button"
                  aria-label={`Abrir ${video.originalName}`}
                  onClick={() => setSelectedVideo(video)}
                >
                  <video src={video.url} muted playsInline preload="metadata" />
                  <span className="thumbnail-overlay">
                    <Maximize2 size={18} />
                    Abrir
                  </span>
                </button>
                <div className="video-card-copy">
                  <div>
                    <h2>{video.originalName}</h2>
                    <p>
                      {formatDuration(video.durationSeconds)} - {formatFileSize(video.size)}
                    </p>
                  </div>
                  <button
                    className="video-delete-button"
                    type="button"
                    aria-label={`Apagar ${video.originalName}`}
                    onClick={() => deleteVideo(video.id)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="video-ai-actions">
                  <button
                    className="prepare-layout-button"
                    type="button"
                    disabled={preparingVideoId === video.id}
                    onClick={() => openLayoutSetup(video)}
                  >
                    <ArrowRight size={15} />
                    {preparingVideoId === video.id ? 'Preparando...' : 'Editar layout'}
                  </button>
                  {video.aiStatus && <span className={`ai-status-badge ${video.aiStatus}`}>{video.aiStatus}</span>}
                </div>
                {/* O diagnóstico técnico da fonte continua disponível no player, mas não interrompe o fluxo principal. */}
                {video.audienceRecommendations?.length ? (
                  <div className="video-audience-recommendations">
                    <div className="video-audience-heading">
                      <strong>Momentos mais assistidos</strong>
                      <span>YouTube</span>
                    </div>
                    <div className="video-audience-list">
                      {video.audienceRecommendations.slice(0, 5).map((recommendation) => (
                        <span key={recommendation.id}>
                          {formatDuration(recommendation.startSeconds)} - {formatDuration(recommendation.endSeconds)}
                          {typeof recommendation.score === 'number' ? ` · ${Math.round(recommendation.score)}%` : ''}
                        </span>
                      ))}
                    </div>
                    <small>Na Produção, escolha “Momentos mais assistidos” para gerar esses cortes.</small>
                  </div>
                ) : video.audienceInsight?.source === 'youtube-most-replayed' ? (
                  <p className="video-audience-empty">{video.audienceInsight.message}</p>
                ) : null}
                <div className="video-optional-ai">
                  <button
                    className="ai-analyze-button"
                    type="button"
                    disabled={processingVideoId === video.id}
                    onClick={() => analyzeVideo(video.id)}
                  >
                    <Bot size={15} />
                    {processingVideoId === video.id
                      ? analysisProgress?.videoId === video.id
                        ? `Analisando ${analysisProgress.progress}%`
                        : 'Analisando...'
                      : 'Diagnóstico técnico'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {selectedVideo && (
          <div className="video-modal-backdrop" role="presentation">
            <section className="video-modal" role="dialog" aria-label={selectedVideo.originalName}>
              <div className="video-modal-header">
                <div>
                  <p className="eyebrow">Player</p>
                  <h2>{selectedVideo.originalName}</h2>
                </div>
                <div className="video-modal-actions">
                  <button
                    className="video-delete-button"
                    type="button"
                    aria-label="Apagar video"
                    onClick={() => deleteVideo(selectedVideo.id)}
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Fechar player"
                    onClick={() => setSelectedVideo(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <video className="video-expanded-player" src={selectedVideo.url} controls preload="metadata" />
              <button className="prepare-layout-button video-modal-next" type="button" disabled={preparingVideoId === selectedVideo.id} onClick={() => openLayoutSetup(selectedVideo)}>
                <ArrowRight size={16} />
                {preparingVideoId === selectedVideo.id ? 'Preparando...' : 'Continuar para editar layout'}
              </button>
              <div className="video-modal-ai">
                <button
                  className="ai-analyze-button"
                  type="button"
                  disabled={processingVideoId === selectedVideo.id}
                  onClick={() => analyzeVideo(selectedVideo.id)}
                >
                  <Bot size={15} />
                  {processingVideoId === selectedVideo.id
                    ? analysisProgress?.videoId === selectedVideo.id
                      ? `Analisando ${analysisProgress.progress}%`
                      : 'Analisando...'
                    : 'Analisar com IA'}
                </button>
                {renderAnalysis(selectedVideo)}
              </div>
            </section>
          </div>
        )}

        {layoutVideo && (
          <div className="video-modal-backdrop" role="presentation">
            <section className="layout-setup-modal" role="dialog" aria-labelledby="layout-setup-title">
              <div className="video-modal-header">
                <div>
                  <p className="eyebrow">Etapa 2 de 6</p>
                  <h2 id="layout-setup-title">Escolha o layout base</h2>
                </div>
                <button className="icon-button" type="button" aria-label="Fechar seleção de layout" onClick={closeLayoutSetup}>
                  <X size={18} />
                </button>
              </div>
              <p className="layout-setup-copy">Monte o formato antes de gerar os cortes. O canvas e as imagens abaixo serão compartilhados por todos eles; depois você ajusta apenas o enquadramento do vídeo em cada trecho.</p>
              <div className="layout-setup-grid">
                {LAYOUT_PRESETS.map((preset) => (
                  <button className={`layout-setup-option ${layoutPreset === preset.id ? 'active' : ''}`} type="button" key={preset.id} onClick={() => setLayoutPreset(preset.id)}>
                    <strong>{preset.shortLabel}</strong>
                    <span>{preset.label}</span>
                    <small>{preset.description}</small>
                  </button>
                ))}
              </div>
              <div className="layout-image-setup">
                <div className="layout-image-setup-heading">
                  <div>
                    <strong>Mídia fixa do layout</strong>
                    <span>Adicione logos, molduras ou imagens que aparecerão em todos os cortes.</span>
                  </div>
                  <label className="layout-image-upload">
                    <ImagePlus size={16} />
                    Adicionar imagem
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple onChange={addLayoutImages} />
                  </label>
                </div>
                {layoutImages.length > 0 ? (
                  <div className="layout-image-list">
                    {layoutImages.map((image, index) => (
                      <div className="layout-image-item" key={`${image.file.name}-${image.file.lastModified}-${index}`}>
                        <img src={image.previewUrl} alt="" />
                        <span title={image.file.name}>{image.file.name}</span>
                        <button type="button" onClick={() => removeLayoutImage(index)} aria-label={`Remover ${image.file.name}`}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="layout-image-empty">Nenhuma imagem fixa adicionada.</p>
                )}
              </div>
              <div className="layout-setup-footer">
                <span>{layoutVideo.originalName}</span>
                <div>
                  <button className="secondary-action" type="button" onClick={closeLayoutSetup}>Cancelar</button>
                  <button className="primary-action" type="button" disabled={preparingVideoId === layoutVideo.id} onClick={() => void startLayout()}>
                    <ArrowRight size={16} />
                    {preparingVideoId === layoutVideo.id ? 'Abrindo editor...' : 'Montar layout e editar'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
