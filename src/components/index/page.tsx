import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Film,
  ListVideo,
  Mic2,
  MoreHorizontal,
  Play,
  Search,
  Sparkles,
  Subtitles,
  Wand2,
} from 'lucide-react';
import {
  exportClipsToGallery,
  generateVideoClips,
  GeneratedClip,
  listUploadedVideos,
  UploadedVideo,
} from '../../lib/videoApi';
import { Header } from '../main/Header';
import { NewClipButton } from '../new-clip/NewClipButton';

const topics = ['TikTok vertical', 'Legendas auto', 'Cortes por silencio', 'Remover pausas'];

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

function formatMinutes(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 min';
  }

  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function IndexPage() {
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [captionClipIds, setCaptionClipIds] = useState<string[]>([]);
  const [subtitleMode, setSubtitleMode] = useState('Legenda automatica');
  const [audioMode, setAudioMode] = useState('Audio original');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    listUploadedVideos()
      .then((loadedVideos) => {
        setVideos(loadedVideos);
        setSelectedVideoId(loadedVideos[0]?.id || '');
      })
      .catch(() => setMessage('Nao foi possivel carregar os videos da pagina Arquivos.'))
      .finally(() => setIsLoading(false));
  }, []);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [selectedVideoId, videos],
  );

  const clips = useMemo(() => selectedVideo?.clips || [], [selectedVideo]);
  const selectedClips = clips.filter((clip) => selectedClipIds.includes(clip.id));

  useEffect(() => {
    const availableClipIds = clips.map((clip) => clip.id);
    setSelectedClipIds((currentIds) => {
      const filteredIds = currentIds.filter((id) => availableClipIds.includes(id));
      return filteredIds.length > 0 ? filteredIds : availableClipIds;
    });
    setCaptionClipIds((currentIds) => {
      const filteredIds = currentIds.filter((id) => availableClipIds.includes(id));
      return filteredIds.length > 0 ? filteredIds : clips.filter((clip) => clip.shouldCaption).map((clip) => clip.id);
    });
  }, [selectedVideoId, clips]);

  async function createClips() {
    if (!selectedVideo) {
      setMessage('Selecione um video salvo em Arquivos antes de gerar os clipes.');
      return;
    }

    try {
      setIsGenerating(true);
      setMessage('');
      const { video, clips: generatedClips } = await generateVideoClips(selectedVideo.id);
      setVideos((currentVideos) =>
        currentVideos.map((currentVideo) => (currentVideo.id === video.id ? video : currentVideo)),
      );
      setSelectedClipIds(generatedClips.map((clip) => clip.id));
      setCaptionClipIds(generatedClips.map((clip) => clip.id));
      setMessage('Clipes gerados para o pacote pronto.');
    } catch {
      setMessage('Nao foi possivel gerar os clipes.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function exportPackage() {
    if (!selectedVideo || selectedClipIds.length === 0) {
      setMessage('Selecione pelo menos um clipe para exportar.');
      return;
    }

    try {
      setIsExporting(true);
      setMessage('');
      await exportClipsToGallery({
        videoId: selectedVideo.id,
        clipIds: selectedClipIds,
        captionClipIds,
        subtitleMode,
        audioMode,
      });
      setMessage('Pacote exportado para a pagina Galeria.');
    } catch {
      setMessage('Nao foi possivel exportar o pacote.');
    } finally {
      setIsExporting(false);
    }
  }

  function toggleClipSelection(clipId: string) {
    setSelectedClipIds((currentIds) =>
      currentIds.includes(clipId)
        ? currentIds.filter((currentId) => currentId !== clipId)
        : [...currentIds, clipId],
    );
  }

  function toggleCaptionSelection(clipId: string) {
    setCaptionClipIds((currentIds) =>
      currentIds.includes(clipId)
        ? currentIds.filter((currentId) => currentId !== clipId)
        : [...currentIds, clipId],
    );
  }

  function renderClipCard(clip: GeneratedClip) {
    const isSelected = selectedClipIds.includes(clip.id);
    const willCaption = captionClipIds.includes(clip.id);

    return (
      <article className={`clip-card ${isSelected ? 'selected' : ''}`} key={clip.id}>
        <label className="clip-check" aria-label={`Selecionar ${clip.title}`}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleClipSelection(clip.id)} />
          <span />
        </label>
        <div className="clip-thumb">
          <Film size={18} />
        </div>
        <div className="clip-copy">
          <h3>{clip.title}</h3>
          <span>
            <Clock3 size={14} />
            {clip.duration} - {clip.range}
          </span>
          <label className="caption-toggle">
            <input type="checkbox" checked={willCaption} onChange={() => toggleCaptionSelection(clip.id)} />
            Legendar este clipe
          </label>
        </div>
        <div className="clip-meta">
          <span className={`status ${clip.status.toLowerCase()}`}>{clip.status}</span>
        </div>
      </article>
    );
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <header className="topbar">
          <div className="searchbox">
            <Search size={18} />
            <input aria-label="Buscar projeto" placeholder="Buscar clips, projetos ou templates" />
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notificacoes">
              <Bell size={18} />
            </button>
            <NewClipButton />
          </div>
        </header>

        <div className="content-grid">
          <section className="generator-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Novo projeto</p>
                <h1>Gere cortes prontos para publicar</h1>
              </div>
              <button className="ghost-button">
                Preset BR
                <ChevronDown size={16} />
              </button>
            </div>

            <div className="dropzone video-selector">
              <div className="upload-symbol">
                <ListVideo size={28} />
              </div>
              <div>
                <h2>Selecione um video salvo</h2>
                <p>Use apenas os videos que ja aparecem na pagina Arquivos.</p>
              </div>
              <select
                className="video-select"
                aria-label="Selecionar video dos arquivos"
                value={selectedVideoId}
                onChange={(event) => setSelectedVideoId(event.target.value)}
                disabled={isLoading || videos.length === 0}
              >
                {videos.length === 0 && <option>Nenhum video em Arquivos</option>}
                {videos.map((video) => (
                  <option value={video.id} key={video.id}>
                    {video.originalName}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-grid">
              <label className="setting-control">
                <span>Formato</span>
                <select aria-label="Formato de saida">
                  <option>9:16 vertical</option>
                  <option>1:1 quadrado</option>
                  <option>16:9 horizontal</option>
                </select>
              </label>
              <label className="setting-control">
                <span>Duracao alvo</span>
                <select aria-label="Duracao alvo">
                  <option>30-60 segundos</option>
                  <option>60-90 segundos</option>
                  <option>Ate 3 minutos</option>
                </select>
              </label>
            </div>

            <div className="topic-row" aria-label="Opcoes rapidas">
              {topics.map((topic) => (
                <button key={topic} className="chip">
                  <Check size={14} />
                  {topic}
                </button>
              ))}
            </div>

            <button className="generate-button" disabled={!selectedVideo || isGenerating} onClick={createClips}>
              <Wand2 size={20} />
              {isGenerating ? 'Gerando clips...' : 'Gerar clips agora'}
            </button>

            {message && <p className="generator-message">{message}</p>}
          </section>

          <section className="preview-panel">
            <div className="video-preview selected-video-preview" aria-label="Preview do video selecionado">
              {selectedVideo ? (
                <video src={selectedVideo.url} controls preload="metadata" />
              ) : (
                <div className="empty-preview">
                  <Play size={28} />
                  <span>Selecione um video em Arquivos</span>
                </div>
              )}
            </div>

            <div className="insight-row">
              <div>
                <span className="metric-label">Duracao do video</span>
                <strong>{formatDuration(selectedVideo?.durationSeconds || 0)}</strong>
              </div>
              <div>
                <span className="metric-label">Minutos</span>
                <strong>{formatMinutes(selectedVideo?.durationSeconds || 0)}</strong>
              </div>
            </div>

            <div className="audio-panel subtitle-panel">
              <div className="audio-title">
                <Mic2 size={18} />
                Legendas e audio
              </div>
              <label className="setting-control">
                <span>Legenda</span>
                <select value={subtitleMode} onChange={(event) => setSubtitleMode(event.target.value)}>
                  <option>Legenda automatica</option>
                  <option>Legenda revisada</option>
                  <option>Sem legenda</option>
                </select>
              </label>
              <label className="setting-control">
                <span>Audio</span>
                <select value={audioMode} onChange={(event) => setAudioMode(event.target.value)}>
                  <option>Audio original</option>
                  <option>Audio limpo</option>
                  <option>Audio com volume normalizado</option>
                </select>
              </label>
            </div>
          </section>

          <section className="clips-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Fila</p>
                <h2>Cortes gerados</h2>
              </div>
              <button className="icon-button" aria-label="Mais opcoes">
                <MoreHorizontal size={18} />
              </button>
            </div>

            <div className="clip-list">
              {clips.length > 0 ? (
                clips.map(renderClipCard)
              ) : (
                <div className="clip-empty">
                  <Subtitles size={24} />
                  <span>Gere os clips para escolher quais cortes vao receber legenda.</span>
                </div>
              )}
            </div>
          </section>

          <section className="export-panel package-panel">
            <div className="export-copy">
              <Sparkles size={20} />
              <div>
                <h2>Pacote pronto</h2>
                <p>
                  {selectedClips.length} clipes selecionados, {captionClipIds.length} marcados para legenda.
                </p>
                <div className="package-list">
                  {selectedClips.map((clip) => (
                    <span key={clip.id}>{clip.title}</span>
                  ))}
                </div>
              </div>
            </div>
            <button
              className="secondary-action dark"
              disabled={!selectedVideo || selectedClipIds.length === 0 || isExporting}
              onClick={exportPackage}
            >
              <Download size={16} />
              {isExporting ? 'Exportando...' : 'Exportar'}
            </button>
          </section>
        </div>
      </section>
    </main>
  );
}
