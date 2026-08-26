import { useEffect, useState } from 'react';
import { Bot, FileVideo2, Maximize2, Trash2, X } from 'lucide-react';
import {
  analyzeUploadedVideo,
  deleteUploadedVideo,
  getAiStatus,
  listUploadedVideos,
  UploadedVideo,
} from '../../lib/videoApi';
import { Header } from '../main/Header';
import { NewClipButton } from '../new-clip/NewClipButton';
import './page.css';

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPage() {
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<UploadedVideo | null>(null);
  const [processingVideoId, setProcessingVideoId] = useState<string | null>(null);
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

  async function analyzeVideo(videoId: string) {
    try {
      setProcessingVideoId(videoId);
      const updatedVideo = await analyzeUploadedVideo(videoId);
      setVideos((currentVideos) =>
        currentVideos.map((video) => (video.id === videoId ? updatedVideo : video)),
      );
      setSelectedVideo((currentVideo) => (currentVideo?.id === videoId ? updatedVideo : currentVideo));
    } catch {
      setError('Nao foi possivel executar a analise de IA.');
    } finally {
      setProcessingVideoId(null);
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
            <p className="eyebrow">Arquivos</p>
            <h1>Arquivos</h1>
          </div>
          <div className="files-heading-actions">
            <span>{videos.length} videos salvos</span>
            <NewClipButton onUploaded={loadVideos} />
          </div>
        </div>

        {aiStatus && (
          <div className="ai-status-panel">
            {Object.entries(aiStatus).map(([name, isReady]) => (
              <span className={isReady ? 'ready' : 'missing'} key={name}>
                {name}: {isReady ? 'ok' : 'pendente'}
              </span>
            ))}
          </div>
        )}

        {isLoading && <div className="route-panel">Carregando videos...</div>}

        {error && <div className="route-panel files-empty">{error}</div>}

        {!isLoading && !error && videos.length === 0 && (
          <div className="route-panel files-empty">
            <FileVideo2 size={34} />
            <h2>Nenhum video enviado</h2>
            <p>Use Novo clip para adicionar um video de ate 10 minutos. Depois siga para Editor.</p>
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
                    className="ai-analyze-button"
                    type="button"
                    disabled={processingVideoId === video.id}
                    onClick={() => analyzeVideo(video.id)}
                  >
                    <Bot size={15} />
                    {processingVideoId === video.id ? 'Analisando...' : 'Analisar IA'}
                  </button>
                  {video.aiStatus && <span className={`ai-status-badge ${video.aiStatus}`}>{video.aiStatus}</span>}
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
              <div className="video-modal-ai">
                <button
                  className="ai-analyze-button"
                  type="button"
                  disabled={processingVideoId === selectedVideo.id}
                  onClick={() => analyzeVideo(selectedVideo.id)}
                >
                  <Bot size={15} />
                  {processingVideoId === selectedVideo.id ? 'Analisando...' : 'Analisar com IA'}
                </button>
                {renderAnalysis(selectedVideo)}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
