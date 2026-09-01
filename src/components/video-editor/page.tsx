import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  AudioLines,
  Check,
  Film,
  ImagePlus,
  Layers3,
  Maximize2,
  Move,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Type,
  Upload,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { listUploadedVideos } from '../../lib/videoApi';
import type { UploadedVideo } from '../../lib/videoApi';
import type { CanvasPreset, CropMode } from '../../features/editor/domain/editor.types';
import { LAYOUT_PRESETS } from '../../features/editor/domain/layout';
import { Header } from '../main/Header';
import './page.css';

type VideoSource = {
  name: string;
  url: string;
  duration?: number;
};

type Position = {
  x: number;
  y: number;
};

type LayerName = 'video' | 'caption' | 'image';

type CanvasSize = {
  width: number;
  height: number;
  preset: CanvasPreset;
};

type VideoTransform = Position & {
  scale: number;
  rotation: number;
  cropMode: CropMode;
};

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
const defaultVideoTransform: VideoTransform = { x: 0, y: 0, scale: 1, rotation: 0, cropMode: 'cover' };

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function clamp(value: number, min = 5, max = 95) {
  return Math.min(max, Math.max(min, value));
}

function getObjectPosition(value: number) {
  return `${clamp(50 + value / 2, 0, 100)}%`;
}

export function VideoEditorPage() {
  const [savedVideos, setSavedVideos] = useState<UploadedVideo[]>([]);
  const [sourceVideo, setSourceVideo] = useState<VideoSource | null>(null);
  const [isLoadingVideos, setIsLoadingVideos] = useState(true);
  const [caption, setCaption] = useState('A ideia que fica depois do play.');
  const [captionVisible, setCaptionVisible] = useState(true);
  const [captionPosition, setCaptionPosition] = useState<Position>({ x: 50, y: 77 });
  const [captionSize, setCaptionSize] = useState(25);
  const [canvas, setCanvas] = useState<CanvasSize>({ width: 1080, height: 1920, preset: 'vertical' });
  const [videoTransform, setVideoTransform] = useState<VideoTransform>(defaultVideoTransform);
  const [overlayImage, setOverlayImage] = useState<{ name: string; url: string } | null>(null);
  const [imagePosition, setImagePosition] = useState<Position>({ x: 74, y: 24 });
  const [imageScale, setImageScale] = useState(25);
  const [selectedLayer, setSelectedLayer] = useState<LayerName>('video');
  const [speed, setSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [music, setMusic] = useState<{ name: string; url: string } | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.7);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragLayerRef = useRef<LayerName | null>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; initial: Position } | null>(null);
  const localVideoUrlRef = useRef<string | null>(null);
  const overlayImageUrlRef = useRef<string | null>(null);
  const musicUrlRef = useRef<string | null>(null);

  useEffect(() => {
    listUploadedVideos()
      .then((videos) => {
        setSavedVideos(videos);
        if (videos[0]) {
          setSourceVideo({ name: videos[0].originalName, url: videos[0].url, duration: videos[0].durationSeconds });
        }
      })
      .catch(() => setMessage('Não foi possível carregar os vídeos de Arquivos. Você ainda pode enviar um vídeo aqui.'))
      .finally(() => setIsLoadingVideos(false));
  }, []);

  useEffect(() => {
    return () => {
      if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
      if (overlayImageUrlRef.current) URL.revokeObjectURL(overlayImageUrlRef.current);
      if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, [speed, sourceVideo]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = musicVolume;
    }
  }, [musicVolume, music]);

  function handleVideoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('video/')) {
      setMessage('Escolha um arquivo de vídeo para editar.');
      return;
    }

    if (localVideoUrlRef.current) URL.revokeObjectURL(localVideoUrlRef.current);
    const url = URL.createObjectURL(file);
    localVideoUrlRef.current = url;
    setSourceVideo({ name: file.name, url });
    setVideoTransform(defaultVideoTransform);
    setSelectedLayer('video');
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setMessage('Vídeo local carregado. As alterações ficam disponíveis neste rascunho.');
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      setMessage('Escolha uma imagem JPG, PNG ou WebP para adicionar ao vídeo.');
      return;
    }

    if (overlayImageUrlRef.current) URL.revokeObjectURL(overlayImageUrlRef.current);
    const url = URL.createObjectURL(file);
    overlayImageUrlRef.current = url;
    setOverlayImage({ name: file.name, url });
    setSelectedLayer('image');
    setMessage('Imagem adicionada. Arraste-a no preview para posicionar.');
  }

  function selectSavedVideo(video: UploadedVideo) {
    setSourceVideo({ name: video.originalName, url: video.url, duration: video.durationSeconds });
    setVideoTransform(defaultVideoTransform);
    setSelectedLayer('video');
    setCurrentTime(0);
    setIsPlaying(false);
  }

  function handleMusicUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('audio/')) {
      setMessage('Escolha um arquivo de áudio MP3, WAV ou M4A.');
      return;
    }

    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    const url = URL.createObjectURL(file);
    musicUrlRef.current = url;
    setMusic({ name: file.name, url });
    setMessage('Música adicionada. Ela toca quando você iniciar o preview.');
  }

  function clearImage() {
    if (overlayImageUrlRef.current) URL.revokeObjectURL(overlayImageUrlRef.current);
    overlayImageUrlRef.current = null;
    setOverlayImage(null);
    setSelectedLayer('caption');
  }

  function clearMusic() {
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    musicUrlRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setMusic(null);
  }

  function togglePlayback() {
    if (!videoRef.current || !sourceVideo) {
      setMessage('Adicione um vídeo para iniciar o preview.');
      return;
    }

    if (videoRef.current.paused) {
      void videoRef.current.play().catch(() => setMessage('O navegador bloqueou o preview automático. Clique em play novamente.'));
    } else {
      videoRef.current.pause();
    }
  }

  function seekVideo(nextTime: number) {
    setCurrentTime(nextTime);
    if (videoRef.current) videoRef.current.currentTime = nextTime;
    if (audioRef.current) audioRef.current.currentTime = nextTime;
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const layer = target.closest<HTMLElement>('[data-editor-layer]')?.dataset.editorLayer as LayerName | undefined;
    if (!layer || !stageRef.current) return;
    dragLayerRef.current = layer;
    setSelectedLayer(layer);
    const initial = layer === 'video'
      ? { x: videoTransform.x, y: videoTransform.y }
      : layer === 'caption'
        ? { x: captionPosition.x, y: captionPosition.y }
        : { x: imagePosition.x, y: imagePosition.y };
    dragStartRef.current = { startX: event.clientX, startY: event.clientY, initial };
    stageRef.current.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const layer = dragLayerRef.current;
    const dragStart = dragStartRef.current;
    if (!layer || !dragStart || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const position = {
      x: dragStart.initial.x + ((event.clientX - dragStart.startX) / rect.width) * 100 * (layer === 'video' ? 2 : 1),
      y: dragStart.initial.y + ((event.clientY - dragStart.startY) / rect.height) * 100 * (layer === 'video' ? 2 : 1),
    };
    if (layer === 'video') setVideoTransform((current) => ({ ...current, x: clamp(position.x, -100, 100), y: clamp(position.y, -100, 100) }));
    if (layer === 'caption') setCaptionPosition({ x: clamp(position.x), y: clamp(position.y) });
    if (layer === 'image') setImagePosition({ x: clamp(position.x), y: clamp(position.y) });
  }

  function handleStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragLayerRef.current = null;
    dragStartRef.current = null;
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
  }

  function resetLayerPosition() {
    if (selectedLayer === 'video') setVideoTransform((current) => ({ ...current, x: 0, y: 0 }));
    if (selectedLayer === 'caption') setCaptionPosition({ x: 50, y: 77 });
    if (selectedLayer === 'image') setImagePosition({ x: 74, y: 24 });
  }

  function selectFormat(preset: CanvasPreset) {
    if (preset === 'custom') {
      setCanvas((current) => ({ ...current, preset }));
      return;
    }

    const selectedPreset = LAYOUT_PRESETS.find((option) => option.id === preset);
    if (!selectedPreset) return;
    setCanvas({ width: selectedPreset.width, height: selectedPreset.height, preset });
  }

  function updateCanvasSize(field: 'width' | 'height', value: string) {
    const nextValue = Math.min(3840, Math.max(320, Math.round(Number(value) || 320)));
    setCanvas((current) => ({ ...current, [field]: nextValue, preset: 'custom' }));
  }

  function updateVideoTransform(field: 'x' | 'y' | 'scale' | 'rotation' | 'cropMode', value: string) {
    setVideoTransform((current) => {
      if (field === 'cropMode') return { ...current, cropMode: value as CropMode };
      const numericValue = Number(value);
      if (field === 'x' || field === 'y') return { ...current, [field]: clamp(numericValue, -100, 100) };
      if (field === 'scale') return { ...current, scale: clamp(numericValue, 0.5, 3) };
      return { ...current, rotation: clamp(numericValue, -180, 180) };
    });
  }

  function resetVideoTransform() {
    setVideoTransform(defaultVideoTransform);
  }

  function saveDraft() {
    setMessage('Rascunho salvo. O próximo passo é renderizar o vídeo final com estas definições.');
  }

  const videoStyle = {
    objectFit: videoTransform.cropMode === 'contain' ? 'contain' as const : 'cover' as const,
    objectPosition: `${getObjectPosition(videoTransform.x)} ${getObjectPosition(videoTransform.y)}`,
    transform: `scale(${videoTransform.scale}) rotate(${videoTransform.rotation}deg)`,
  };

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace studio-page video-studio">
        <div className="studio-topbar workflow-heading">
          <div>
            <p className="eyebrow">Estúdio de vídeo</p>
            <h1>Encontre o quadro certo.</h1>
            <p className="studio-lede">Escolha o formato, reposicione o vídeo no canvas e ajuste suas camadas antes de exportar.</p>
          </div>
          <div className="studio-status"><span className="studio-live-dot" /><span>Rascunho não renderizado</span><button type="button" className="secondary-action" onClick={saveDraft}>Salvar rascunho</button></div>
        </div>

        <div className="video-editor-layout">
          <aside className="video-source-panel studio-card">
            <div className="studio-card-heading"><div><span className="studio-kicker">Fonte</span><h2>Seu vídeo</h2></div><Film size={19} /></div>
            <label className="video-upload-button"><Upload size={16} /><span>Enviar vídeo</span><small>MP4, MOV ou WebM</small><input type="file" accept="video/*" onChange={handleVideoUpload} /></label>
            <div className="source-divider"><span>ou escolha em Arquivos</span></div>
            <div className="saved-video-list">
              {isLoadingVideos && <p className="editor-muted">Carregando vídeos...</p>}
              {!isLoadingVideos && savedVideos.length === 0 && <p className="editor-muted">Nenhum vídeo salvo ainda.</p>}
              {savedVideos.map((video) => <button type="button" key={video.id} className={`saved-video-option ${sourceVideo?.url === video.url ? 'active' : ''}`} onClick={() => selectSavedVideo(video)}><span className="saved-video-icon"><Video size={14} /></span><span><strong>{video.originalName}</strong><small>{formatTime(video.durationSeconds)} · Arquivos</small></span>{sourceVideo?.url === video.url && <Check size={14} />}</button>)}
            </div>
            <div className="source-selected"><span className="source-selected-label">Em edição</span><strong>{sourceVideo?.name || 'Nenhum vídeo selecionado'}</strong><span>{sourceVideo ? `${formatTime(duration || sourceVideo.duration || 0)} · ${canvas.width} × ${canvas.height}` : 'Adicione um vídeo para começar'}</span></div>
          </aside>

          <section className="video-preview-column">
            <div className="preview-header"><div><span className="studio-kicker">Preview interativo</span><h2>Arraste as camadas no quadro</h2></div><span className="preview-meta"><Maximize2 size={13} /> {canvas.width} × {canvas.height}</span></div>
            <div className="video-stage-wrap">
              <div className="video-stage" ref={stageRef} style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }} onPointerDown={handleStagePointerDown} onPointerMove={handleStagePointerMove} onPointerUp={handleStagePointerUp} onPointerCancel={handleStagePointerUp}>
                {sourceVideo ? <video ref={videoRef} data-editor-layer="video" className={`stage-video ${selectedLayer === 'video' ? 'selected' : ''}`} src={sourceVideo.url} muted={isMuted} playsInline preload="metadata" style={videoStyle} onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || sourceVideo.duration || 0); event.currentTarget.playbackRate = speed; }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => { setIsPlaying(true); if (music && audioRef.current) void audioRef.current.play().catch(() => undefined); }} onPause={() => { setIsPlaying(false); audioRef.current?.pause(); }} onEnded={() => { setIsPlaying(false); audioRef.current?.pause(); }} /> : <div className="stage-empty"><Video size={28} /><strong>Seu vídeo aparece aqui</strong><span>Envie um arquivo ou escolha um vídeo em Arquivos</span></div>}
                {captionVisible && caption && <div data-editor-layer="caption" className={`video-overlay-caption ${selectedLayer === 'caption' ? 'selected' : ''}`} style={{ left: `${captionPosition.x}%`, top: `${captionPosition.y}%`, fontSize: `${captionSize}px` }}>{caption}<span className="layer-grip"><Move size={12} /></span></div>}
                {overlayImage && <div data-editor-layer="image" className={`video-overlay-image ${selectedLayer === 'image' ? 'selected' : ''}`} style={{ left: `${imagePosition.x}%`, top: `${imagePosition.y}%`, width: `${imageScale}%` }}><img src={overlayImage.url} alt="Imagem sobreposta ao vídeo" /><span className="layer-grip"><Move size={12} /></span></div>}
                <span className="stage-safe-area" />
                <span className="stage-watermark">CLIPCUT / PREVIEW</span>
              </div>
            </div>
            <div className="preview-controls"><button type="button" className="play-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pausar preview' : 'Reproduzir preview'}>{isPlaying ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><span className="time-readout">{formatTime(currentTime)} <i>/</i> {formatTime(duration || sourceVideo?.duration || 0)}</span><input className="preview-scrubber" aria-label="Posição do vídeo" type="range" min="0" max={duration || sourceVideo?.duration || 1} step="0.01" value={Math.min(currentTime, duration || sourceVideo?.duration || 1)} onChange={(event) => seekVideo(Number(event.target.value))} /><span className="preview-speed-label">{speed}×</span></div>
            {music && <audio ref={audioRef} src={music.url} preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.volume = musicVolume; }} />}
          </section>

          <aside className="video-inspector studio-card">
            <div className="studio-card-heading"><div><span className="studio-kicker">Camadas e controles</span><h2>Composição</h2></div><Layers3 size={19} /></div>

            <div className="editor-control-group format-control-group">
              <div className="control-heading"><span>Formato do vídeo</span><strong className="control-value">{canvas.width} × {canvas.height}</strong></div>
              <div className="format-grid">
                {LAYOUT_PRESETS.map((preset) => (
                  <button type="button" key={preset.id} className={canvas.preset === preset.id ? 'active' : ''} onClick={() => selectFormat(preset.id)}>
                    <strong>{preset.shortLabel}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
                <button type="button" className={canvas.preset === 'custom' ? 'active' : ''} onClick={() => selectFormat('custom')}>
                  <strong>Custom</strong>
                  <small>Dimensões próprias</small>
                </button>
              </div>
              <div className="format-fields">
                <label><span>Largura (px)</span><input type="number" min="320" max="3840" value={canvas.width} onChange={(event) => updateCanvasSize('width', event.target.value)} /></label>
                <label><span>Altura (px)</span><input type="number" min="320" max="3840" value={canvas.height} onChange={(event) => updateCanvasSize('height', event.target.value)} /></label>
              </div>
            </div>

            <div className="layer-list">
              <button type="button" className={`layer-row ${selectedLayer === 'video' ? 'active' : ''}`} onClick={() => setSelectedLayer('video')}><span className="layer-icon video-icon"><Film size={15} /></span><span><strong>Vídeo</strong><small>Enquadramento e posição</small></span><span className="layer-order">01</span></button>
              <button type="button" className={`layer-row ${selectedLayer === 'caption' ? 'active' : ''}`} onClick={() => setSelectedLayer('caption')}><span className="layer-icon caption-icon"><Type size={15} /></span><span><strong>Legenda</strong><small>{captionVisible ? 'Visível no vídeo' : 'Oculta no vídeo'}</small></span><span className="layer-order">02</span></button>
              <button type="button" className={`layer-row ${selectedLayer === 'image' ? 'active' : ''} ${!overlayImage ? 'empty' : ''}`} onClick={() => overlayImage && setSelectedLayer('image')}><span className="layer-icon image-icon"><ImagePlus size={15} /></span><span><strong>{overlayImage ? 'Imagem sobreposta' : 'Adicionar imagem'}</strong><small>{overlayImage?.name || 'Logo, sticker ou foto'}</small></span><span className="layer-order">03</span></button>
            </div>

            <div className="editor-control-group video-transform-group">
              <div className="control-heading"><span>Enquadramento do vídeo</span><button type="button" className="reset-control" onClick={resetVideoTransform}><RotateCcw size={13} /> Resetar</button></div>
              <p className="editor-helper"><Move size={13} /> Arraste o vídeo no preview ou ajuste os valores abaixo.</p>
              <div className="transform-fields">
                <label><span>Posição X</span><input type="number" min="-100" max="100" step="1" value={Math.round(videoTransform.x)} onChange={(event) => updateVideoTransform('x', event.target.value)} /></label>
                <label><span>Posição Y</span><input type="number" min="-100" max="100" step="1" value={Math.round(videoTransform.y)} onChange={(event) => updateVideoTransform('y', event.target.value)} /></label>
              </div>
              <label className="range-control"><span>Zoom <strong>{videoTransform.scale.toFixed(2)}×</strong></span><input type="range" min="0.5" max="3" step="0.01" value={videoTransform.scale} onChange={(event) => updateVideoTransform('scale', event.target.value)} /></label>
              <div className="transform-fields">
                <label><span>Rotação (°)</span><input type="number" min="-180" max="180" step="1" value={Math.round(videoTransform.rotation)} onChange={(event) => updateVideoTransform('rotation', event.target.value)} /></label>
                <label><span>Preenchimento</span><select value={videoTransform.cropMode} onChange={(event) => updateVideoTransform('cropMode', event.target.value)}><option value="cover">Preencher</option><option value="contain">Conter</option><option value="custom">Personalizado</option></select></label>
              </div>
            </div>

            <div className="editor-control-group"><div className="control-heading"><span>Legenda</span><label className="switch-control"><input type="checkbox" checked={captionVisible} onChange={(event) => setCaptionVisible(event.target.checked)} /><span /></label></div><label className="editor-field"><span>Texto</span><textarea rows={3} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Escreva uma legenda para o vídeo" /></label><label className="range-control"><span>Tamanho <strong>{captionSize}px</strong></span><input type="range" min="14" max="54" value={captionSize} onChange={(event) => setCaptionSize(Number(event.target.value))} /></label></div>

            <div className="editor-control-group"><div className="control-heading"><span>Posicionamento</span><button type="button" className="reset-control" onClick={resetLayerPosition}><RotateCcw size={13} /> Resetar</button></div><p className="editor-helper"><Move size={13} /> Selecione uma camada e arraste no preview.</p><div className="position-readout"><span>X <strong>{Math.round(selectedLayer === 'video' ? videoTransform.x : selectedLayer === 'caption' ? captionPosition.x : imagePosition.x)}%</strong></span><span>Y <strong>{Math.round(selectedLayer === 'video' ? videoTransform.y : selectedLayer === 'caption' ? captionPosition.y : imagePosition.y)}%</strong></span></div></div>

            <div className="editor-control-group"><div className="control-heading"><span>Imagem</span><label className="mini-upload"><ImagePlus size={13} /> Trocar <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} /></label></div>{overlayImage ? <div className="current-image-row"><img src={overlayImage.url} alt="" /><span title={overlayImage.name}>{overlayImage.name}</span><button type="button" onClick={clearImage} aria-label="Remover imagem"><X size={14} /></button></div> : <label className="empty-layer-upload"><ImagePlus size={15} /><span>Adicionar logo, foto ou sticker</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} /></label>}{overlayImage && <label className="range-control"><span>Escala <strong>{imageScale}%</strong></span><input type="range" min="10" max="70" value={imageScale} onChange={(event) => setImageScale(Number(event.target.value))} /></label>}</div>

            <div className="editor-control-group"><div className="control-heading"><span>Velocidade</span><strong className="control-value">{speed}×</strong></div><div className="speed-grid">{speedOptions.map((option) => <button type="button" key={option} className={speed === option ? 'active' : ''} onClick={() => setSpeed(option)}>{option}×</button>)}</div></div>

            <div className="editor-control-group audio-control-group"><div className="control-heading"><span>Áudio</span><button type="button" className="sound-toggle" onClick={() => setIsMuted((current) => !current)}>{isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />} {isMuted ? 'Sem som original' : 'Som original'}</button></div><label className="music-upload"><Music2 size={16} /><span>{music ? 'Trocar música' : 'Adicionar música'}</span><small>{music?.name || 'MP3, WAV ou M4A'}</small><input type="file" accept="audio/*" onChange={handleMusicUpload} /></label>{music && <><div className="music-file-row"><AudioLines size={14} /><span title={music.name}>{music.name}</span><button type="button" onClick={clearMusic} aria-label="Remover música"><X size={14} /></button></div><label className="range-control"><span>Volume da música <strong>{Math.round(musicVolume * 100)}%</strong></span><input type="range" min="0" max="1" step="0.05" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></label></>}</div>
          </aside>
        </div>

        <section className="video-timeline studio-card"><div className="timeline-header"><div><span className="studio-kicker">Linha do tempo</span><h2>Prévia do vídeo</h2></div><span>{formatTime(duration || sourceVideo?.duration || 0)} de vídeo</span></div><div className="timeline-ruler"><span>0:00</span><span>{formatTime((duration || sourceVideo?.duration || 0) / 2)}</span><span>{formatTime(duration || sourceVideo?.duration || 0)}</span></div><div className="timeline-lane"><span className="timeline-label">VÍDEO</span><div className="timeline-track video-track"><span style={{ width: `${Math.max(8, ((duration || sourceVideo?.duration || 1) / (duration || sourceVideo?.duration || 1)) * 100)}%` }} /><i style={{ left: `${((currentTime / (duration || sourceVideo?.duration || 1)) * 100)}%` }} /></div></div><div className="timeline-lane"><span className="timeline-label">ÁUDIO</span>{music ? <div className="timeline-track audio-track"><span /><b><AudioLines size={13} /> {music.name}</b></div> : <label className="timeline-empty"><Music2 size={13} /> Adicione uma música no painel <input type="file" accept="audio/*" onChange={handleMusicUpload} /></label>}</div><div className="timeline-legend"><span><i className="legend-dot video-dot" /> vídeo original {isMuted ? '· silenciado' : ''}</span><span><i className="legend-dot caption-dot" /> legenda {captionVisible ? '· ativa' : '· oculta'}</span>{music && <span><i className="legend-dot audio-dot" /> música adicionada</span>}</div></section>

        {message && <div className="studio-toast" role="status"><Check size={16} /> {message}<button type="button" aria-label="Fechar mensagem" onClick={() => setMessage('')}>×</button></div>}
      </section>
    </main>
  );
}
