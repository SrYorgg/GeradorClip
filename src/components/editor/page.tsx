import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Camera,
  ImagePlus,
  Layers3,
  MonitorPlay,
  Move,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import {
  analyzeUploadedVideo,
  listUploadedVideos,
  UploadedVideo,
} from '../../lib/videoApi';
import { formatDuration } from '../../lib/formatters';
import { Header } from '../main/Header';
import './page.css';

type BaseLayerId = 'video' | 'camera' | 'thumb';
type LayerId = BaseLayerId | `image:${string}`;

type LayoutBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type OverlayImage = LayoutBox & {
  id: string;
  name: string;
  url: string;
};

const defaultVideoBox: LayoutBox = { x: 0, y: 0, width: 100, height: 100 };
const defaultCameraBox: LayoutBox = { x: 62, y: 66, width: 30, height: 17 };
const defaultThumbBox: LayoutBox = { x: 6, y: 6, width: 34, height: 19 };

function clampBox(box: LayoutBox): LayoutBox {
  const width = Math.min(100, Math.max(8, Math.round(box.width)));
  const height = Math.min(100, Math.max(8, Math.round(box.height)));

  return {
    width,
    height,
    x: Math.min(100 - width, Math.max(0, Math.round(box.x))),
    y: Math.min(100 - height, Math.max(0, Math.round(box.y))),
  };
}

function getAiSummary(video: UploadedVideo | null) {
  const tools = video?.analysis?.tools;

  if (!tools) {
    return null;
  }

  return {
    ollama: tools.ollama?.response || '',
    transcript: tools.whisperx?.text || '',
    faces: tools.mediapipe?.framesWithFaces || 0,
    samples: tools.mediapipe?.sampledFrames || 0,
  };
}

function boxStyle(box: LayoutBox): CSSProperties {
  return {
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  };
}

export function EditorPage() {
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [activeLayerId, setActiveLayerId] = useState<LayerId>('video');
  const [videoBox, setVideoBox] = useState<LayoutBox>(defaultVideoBox);
  const [cameraBox, setCameraBox] = useState<LayoutBox>(defaultCameraBox);
  const [thumbBox, setThumbBox] = useState<LayoutBox>(defaultThumbBox);
  const [showCamera, setShowCamera] = useState(true);
  const [showThumb, setShowThumb] = useState(true);
  const [overlayImages, setOverlayImages] = useState<OverlayImage[]>([]);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    listUploadedVideos()
      .then((loadedVideos) => {
        setVideos(loadedVideos);
        setSelectedVideoId(loadedVideos[0]?.id || '');
      })
      .catch(() => setMessage('Nao foi possivel carregar os videos salvos.'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [selectedVideoId, videos],
  );
  const aiSummary = getAiSummary(selectedVideo);
  const activeOverlayId = activeLayerId.startsWith('image:') ? activeLayerId.replace('image:', '') : '';
  const activeOverlay = overlayImages.find((image) => image.id === activeOverlayId) || null;
  const activeBox =
    activeLayerId === 'video'
      ? videoBox
      : activeLayerId === 'camera'
        ? cameraBox
        : activeLayerId === 'thumb'
          ? thumbBox
          : activeOverlay;

  function getActiveLayerLabel() {
    if (activeLayerId === 'video') {
      return 'Video';
    }

    if (activeLayerId === 'camera') {
      return 'Camera';
    }

    if (activeLayerId === 'thumb') {
      return 'Thumb';
    }

    return activeOverlay?.name || 'Imagem';
  }

  function updateLayerBox(layerId: LayerId, changes: Partial<LayoutBox>) {
    if (layerId === 'video') {
      setVideoBox((currentBox) => clampBox({ ...currentBox, ...changes }));
      return;
    }

    if (layerId === 'camera') {
      setCameraBox((currentBox) => clampBox({ ...currentBox, ...changes }));
      return;
    }

    if (layerId === 'thumb') {
      setThumbBox((currentBox) => clampBox({ ...currentBox, ...changes }));
      return;
    }

    const imageId = layerId.replace('image:', '');
    setOverlayImages((currentImages) =>
      currentImages.map((image) =>
        image.id === imageId ? { ...image, ...clampBox({ ...image, ...changes }) } : image,
      ),
    );
  }

  function updateActiveLayer(changes: Partial<LayoutBox>) {
    updateLayerBox(activeLayerId, changes);
  }

  function centerActiveLayer(axis: 'horizontal' | 'vertical' | 'both') {
    if (!activeBox) {
      return;
    }

    updateActiveLayer({
      x: axis === 'horizontal' || axis === 'both' ? (100 - activeBox.width) / 2 : activeBox.x,
      y: axis === 'vertical' || axis === 'both' ? (100 - activeBox.height) / 2 : activeBox.y,
    });
  }

  async function analyzeSelectedVideo() {
    if (!selectedVideo) {
      setMessage('Selecione um video antes de usar a IA.');
      return;
    }

    try {
      setIsAnalyzing(true);
      setMessage('');
      const updatedVideo = await analyzeUploadedVideo(selectedVideo.id);
      setVideos((currentVideos) =>
        currentVideos.map((video) => (video.id === updatedVideo.id ? updatedVideo : video)),
      );
      setMessage('Analise de IA aplicada ao editor.');
    } catch {
      setMessage('Nao foi possivel executar a analise de IA.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function applyAiPreset() {
    const faceRatio =
      aiSummary && aiSummary.samples > 0 ? aiSummary.faces / aiSummary.samples : 0;

    setVideoBox(faceRatio > 0.45 ? { x: 6, y: 24, width: 88, height: 50 } : defaultVideoBox);
    setCameraBox(faceRatio > 0.45 ? { x: 62, y: 67, width: 30, height: 17 } : { x: 35, y: 6, width: 30, height: 17 });
    setThumbBox(defaultThumbBox);
    setShowCamera(true);
    setShowThumb(true);
    setActiveLayerId('video');
    setMessage('Sugestao aplicada. Agora ajuste manualmente posicao e tamanho.');
  }

  function addOverlayImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);

    if (files.length === 0) {
      return;
    }

    const nextImages = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);

      return {
        id: `${file.name}-${Date.now()}-${index}`,
        name: file.name,
        url,
        x: 12 + index * 6,
        y: 56 + index * 5,
        width: 30,
        height: 18,
      };
    });

    setOverlayImages((currentImages) => [...currentImages, ...nextImages]);
    setActiveLayerId(`image:${nextImages[0]?.id || ''}`);
    event.target.value = '';
  }

  function removeOverlay(imageId: string) {
    const image = overlayImages.find((currentImage) => currentImage.id === imageId);

    if (image) {
      URL.revokeObjectURL(image.url);
      objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== image.url);
    }

    setOverlayImages((currentImages) => currentImages.filter((currentImage) => currentImage.id !== imageId));
    setActiveLayerId((currentId) => (currentId === `image:${imageId}` ? 'video' : currentId));
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="editor-heading">
          <div>
            <p className="eyebrow">Editor TikTok</p>
            <h1>Edite o layout antes de legendar</h1>
          </div>
          <span>{videos.length} videos em Arquivos</span>
        </div>

        <div className="editor-grid">
          <section className="editor-panel editor-controls">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Fonte</p>
                <h2>Video base</h2>
              </div>
              <Video size={20} />
            </div>

            <label className="setting-control">
              <span>Arquivo</span>
              <select
                aria-label="Selecionar video para editar"
                value={selectedVideoId}
                onChange={(event) => setSelectedVideoId(event.target.value)}
                disabled={isLoading || videos.length === 0}
              >
                {videos.length === 0 && <option>Nenhum video salvo</option>}
                {videos.map((video) => (
                  <option value={video.id} key={video.id}>
                    {video.originalName}
                  </option>
                ))}
              </select>
            </label>

            <div className="layer-picker">
              <button
                className={activeLayerId === 'video' ? 'active' : ''}
                type="button"
                onClick={() => setActiveLayerId('video')}
              >
                Video
              </button>
              <button
                className={activeLayerId === 'camera' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setShowCamera(true);
                  setActiveLayerId('camera');
                }}
              >
                Camera
              </button>
              <button
                className={activeLayerId === 'thumb' ? 'active' : ''}
                type="button"
                onClick={() => {
                  setShowThumb(true);
                  setActiveLayerId('thumb');
                }}
              >
                Thumb
              </button>
            </div>

            <div className="layer-toggles">
              <label>
                <input type="checkbox" checked={showCamera} onChange={(event) => setShowCamera(event.target.checked)} />
                Camera visivel
              </label>
              <label>
                <input type="checkbox" checked={showThumb} onChange={(event) => setShowThumb(event.target.checked)} />
                Thumb visivel
              </label>
            </div>

            <div className="manual-controls">
              <div className="manual-controls-heading">
                <p className="eyebrow">Selecionado</p>
                <h2>{getActiveLayerLabel()}</h2>
              </div>

              <div className="align-actions">
                <button type="button" className="ghost-button" disabled={!activeBox} onClick={() => centerActiveLayer('horizontal')}>
                  Centralizar X
                </button>
                <button type="button" className="ghost-button" disabled={!activeBox} onClick={() => centerActiveLayer('vertical')}>
                  Centralizar Y
                </button>
                <button type="button" className="ghost-button" disabled={!activeBox} onClick={() => centerActiveLayer('both')}>
                  Centro total
                </button>
              </div>

              <div className="editor-control-grid">
                <label className="setting-control">
                  <span>Horizontal</span>
                  <input
                    aria-label="Posicao horizontal da camada"
                    type="range"
                    min="0"
                    max="100"
                    value={activeBox?.x || 0}
                    disabled={!activeBox}
                    onChange={(event) => updateActiveLayer({ x: Number(event.target.value) })}
                  />
                </label>
                <label className="setting-control">
                  <span>Vertical</span>
                  <input
                    aria-label="Posicao vertical da camada"
                    type="range"
                    min="0"
                    max="100"
                    value={activeBox?.y || 0}
                    disabled={!activeBox}
                    onChange={(event) => updateActiveLayer({ y: Number(event.target.value) })}
                  />
                </label>
                <label className="setting-control">
                  <span>Largura</span>
                  <input
                    aria-label="Largura da camada"
                    type="range"
                    min="8"
                    max="100"
                    value={activeBox?.width || 0}
                    disabled={!activeBox}
                    onChange={(event) => updateActiveLayer({ width: Number(event.target.value) })}
                  />
                </label>
                <label className="setting-control">
                  <span>Altura</span>
                  <input
                    aria-label="Altura da camada"
                    type="range"
                    min="8"
                    max="100"
                    value={activeBox?.height || 0}
                    disabled={!activeBox}
                    onChange={(event) => updateActiveLayer({ height: Number(event.target.value) })}
                  />
                </label>
              </div>
            </div>

            <div className="editor-ai-panel">
              <div className="editor-ai-title">
                <Bot size={18} />
                <strong>IA de layout</strong>
              </div>
              <div className="editor-ai-actions">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={!selectedVideo || isAnalyzing}
                  onClick={analyzeSelectedVideo}
                >
                  <Sparkles size={16} />
                  {isAnalyzing ? 'Analisando...' : 'Analisar cena'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!aiSummary}
                  onClick={applyAiPreset}
                >
                  <Move size={16} />
                  Sugerir layout
                </button>
              </div>

              {aiSummary ? (
                <div className="editor-ai-result">
                  <span>
                    MediaPipe: {aiSummary.faces}/{aiSummary.samples || 0} amostras com rosto
                  </span>
                  {aiSummary.ollama && <p>{aiSummary.ollama}</p>}
                  {!aiSummary.ollama && aiSummary.transcript && <p>{aiSummary.transcript}</p>}
                </div>
              ) : (
                <p className="editor-muted">Use a analise para sugerir uma base e ajuste tudo manualmente depois.</p>
              )}
            </div>

            {message && <p className="generator-message">{message}</p>}
          </section>

          <section className="editor-stage-panel">
            <div className="editor-stage-toolbar">
              <div>
                <p className="eyebrow">Preview 9:16</p>
                <h2>{selectedVideo?.originalName || 'Nenhum video selecionado'}</h2>
              </div>
              <span>{formatDuration(selectedVideo?.durationSeconds || 0)}</span>
            </div>

            <div className="shorts-stage" aria-label="Area de edicao vertical">
              {selectedVideo ? (
                <button
                  className={`stage-video-slot editable-layer ${activeLayerId === 'video' ? 'active' : ''}`}
                  type="button"
                  style={boxStyle(videoBox)}
                  aria-label="Selecionar camada de video"
                  onClick={() => setActiveLayerId('video')}
                >
                  <video src={selectedVideo.url} autoPlay muted loop playsInline preload="metadata" />
                </button>
              ) : (
                <div className="stage-empty">
                  <MonitorPlay size={34} />
                  <span>Selecione um video salvo</span>
                </div>
              )}

              {showCamera && (
                <button
                  className={`camera-frame editable-layer ${activeLayerId === 'camera' ? 'active' : ''}`}
                  type="button"
                  style={boxStyle(cameraBox)}
                  aria-label="Selecionar camada de camera"
                  onClick={() => setActiveLayerId('camera')}
                >
                  <Camera size={22} />
                  <span>CAM</span>
                </button>
              )}

              {showThumb && selectedVideo && (
                <button
                  className={`thumb-frame editable-layer ${activeLayerId === 'thumb' ? 'active' : ''}`}
                  type="button"
                  style={boxStyle(thumbBox)}
                  aria-label="Selecionar camada de thumb"
                  onClick={() => setActiveLayerId('thumb')}
                >
                  <video src={selectedVideo.url} muted playsInline preload="metadata" />
                  <span>Thumb</span>
                </button>
              )}

              {overlayImages.map((image) => (
                <button
                  className={`stage-image-overlay editable-layer ${image.id === activeOverlayId ? 'active' : ''}`}
                  key={image.id}
                  type="button"
                  aria-label={`Selecionar imagem ${image.name}`}
                  style={boxStyle(image)}
                  onClick={() => setActiveLayerId(`image:${image.id}`)}
                >
                  <img src={image.url} alt="" />
                </button>
              ))}
            </div>
          </section>

          <section className="editor-panel overlay-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">Camadas</p>
                <h2>Imagens no video</h2>
              </div>
              <Layers3 size={20} />
            </div>

            <label className="image-upload-button">
              <ImagePlus size={17} />
              Adicionar imagens
              <input type="file" accept="image/*" multiple onChange={addOverlayImages} />
            </label>

            <div className="overlay-list">
              {overlayImages.length === 0 && (
                <div className="overlay-empty">
                  <ImagePlus size={22} />
                  <span>Nenhuma imagem adicionada.</span>
                </div>
              )}

              {overlayImages.map((image) => (
                <article className={`overlay-item ${image.id === activeOverlayId ? 'active' : ''}`} key={image.id}>
                  <button type="button" onClick={() => setActiveLayerId(`image:${image.id}`)}>
                    <img src={image.url} alt="" />
                    <span>{image.name}</span>
                  </button>
                  <button
                    className="video-delete-button"
                    type="button"
                    aria-label={`Remover ${image.name}`}
                    onClick={() => removeOverlay(image.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
