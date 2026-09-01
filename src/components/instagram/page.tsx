import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  AlignLeft,
  Camera,
  Check,
  Copy,
  ImagePlus,
  LayoutTemplate,
  Move,
  Palette,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Video,
} from 'lucide-react';
import { Header } from '../main/Header';
import '../workflow/workflow.css';
import './page.css';
import './free-layout.css';

type FeedFormat = 'portrait' | 'square';
type TemplateStyle = 'editorial' | 'promo' | 'quote';
type TextLayerKey = 'headline' | 'support' | 'footer';
type CanvasLayer = 'video' | 'image' | TextLayerKey;

type Position = { x: number; y: number };

type StudioAsset = {
  id: string;
  name: string;
  url: string;
};

type BulkPost = {
  id: string;
  title: string;
  caption: string;
  imageUrl: string;
  status: 'Rascunho' | 'Pronto';
  selected: boolean;
};

const templateOptions: Array<{ id: TemplateStyle; label: string; description: string; accent: string }> = [
  { id: 'editorial', label: 'Editorial', description: 'Tipografia forte e respiro', accent: '#65dfb3' },
  { id: 'promo', label: 'Oferta', description: 'Chamada direta para conversão', accent: '#f5c96b' },
  { id: 'quote', label: 'Citação', description: 'Frase em destaque', accent: '#9887ff' },
];

const textLayerOptions: Array<{ id: TextLayerKey; label: string; description: string }> = [
  { id: 'headline', label: 'Título', description: 'Chamada principal' },
  { id: 'support', label: 'Texto de apoio', description: 'Contexto adicional' },
  { id: 'footer', label: 'Rodapé', description: 'Perfil, data ou assinatura' },
];

function createAssetId() {
  return `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createPostId() {
  return `bulk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number) {
  return Math.min(97, Math.max(3, value));
}

export function InstagramStudioPage() {
  const [activeTab, setActiveTab] = useState<'layout' | 'bulk'>('layout');
  const [format, setFormat] = useState<FeedFormat>('portrait');
  const [template, setTemplate] = useState<TemplateStyle | null>(null);
  const [headline, setHeadline] = useState('');
  const [support, setSupport] = useState('');
  const [footer, setFooter] = useState('');
  const [visibleTextLayers, setVisibleTextLayers] = useState<Record<TextLayerKey, boolean>>({
    headline: false,
    support: false,
    footer: false,
  });
  const [positions, setPositions] = useState<Record<CanvasLayer, Position>>({
    video: { x: 50, y: 50 },
    image: { x: 50, y: 50 },
    headline: { x: 50, y: 35 },
    support: { x: 50, y: 53 },
    footer: { x: 50, y: 82 },
  });
  const [mediaScale, setMediaScale] = useState(76);
  const [backgroundColor, setBackgroundColor] = useState('#101721');
  const [accent, setAccent] = useState('#65dfb3');
  const [align, setAlign] = useState<'left' | 'center'>('left');
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [overlayVideo, setOverlayVideo] = useState<{ name: string; url: string } | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<{ name: string; url: string } | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<CanvasLayer | null>(null);
  const [bulkPosts, setBulkPosts] = useState<BulkPost[]>([]);
  const [publishDate, setPublishDate] = useState('Hoje, 18:30');
  const [message, setMessage] = useState('');
  const assetUrlsRef = useRef<string[]>([]);
  const backgroundUrlRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragLayerRef = useRef<CanvasLayer | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) || null,
    [assets, selectedAssetId],
  );
  const selectedPosts = bulkPosts.filter((post) => post.selected);
  const activeTemplate = template ? templateOptions.find((option) => option.id === template) || null : null;
  const layerCount = Number(Boolean(overlayVideo)) + Number(Boolean(selectedAsset)) + Object.values(visibleTextLayers).filter(Boolean).length;

  useEffect(() => () => {
    assetUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  function registerUrl(url: string) {
    assetUrlsRef.current.push(url);
    return url;
  }

  function addAssets(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    event.target.value = '';

    if (files.length === 0) {
      setMessage('Escolha uma imagem JPG, PNG ou WebP para continuar.');
      return;
    }

    const newAssets = files.map((file) => ({
      id: createAssetId(),
      name: file.name,
      url: registerUrl(URL.createObjectURL(file)),
    }));
    setAssets((currentAssets) => [...currentAssets, ...newAssets]);
    setSelectedAssetId((currentId) => currentId || newAssets[0].id);
    setSelectedLayer('image');
    setBulkPosts((currentPosts) => [
      ...currentPosts,
      ...newAssets.map((asset, index): BulkPost => ({
        id: createPostId(),
        title: `Post ${String(currentPosts.length + index + 1).padStart(2, '0')}`,
        caption: '',
        imageUrl: asset.url,
        status: 'Rascunho',
        selected: true,
      })),
    ]);
    setMessage(`${files.length} imagem(ns) adicionada(s).`);
  }

  function removeAsset(assetId: string) {
    const asset = assets.find((currentAsset) => currentAsset.id === assetId);
    if (asset) URL.revokeObjectURL(asset.url);
    setAssets((currentAssets) => currentAssets.filter((currentAsset) => currentAsset.id !== assetId));
    setSelectedAssetId((currentId) => (currentId === assetId ? '' : currentId));
    setSelectedLayer((currentLayer) => (currentLayer === 'image' ? null : currentLayer));
  }

  function updateTemplate(nextTemplate: TemplateStyle | null) {
    setTemplate(nextTemplate);
    const nextOption = nextTemplate ? templateOptions.find((option) => option.id === nextTemplate) : null;
    if (nextOption) setAccent(nextOption.accent);
  }

  function toggleTextLayer(layer: TextLayerKey) {
    setVisibleTextLayers((current) => ({ ...current, [layer]: !current[layer] }));
    setSelectedLayer((currentLayer) => (currentLayer === layer ? null : layer));
  }

  function updateTextLayer(layer: TextLayerKey, value: string) {
    if (layer === 'headline') setHeadline(value);
    if (layer === 'support') setSupport(value);
    if (layer === 'footer') setFooter(value);
  }

  function getTextLayerValue(layer: TextLayerKey) {
    return layer === 'headline' ? headline : layer === 'support' ? support : footer;
  }

  function addBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      setMessage('Escolha uma imagem para usar como plano de fundo.');
      return;
    }
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
    const url = registerUrl(URL.createObjectURL(file));
    backgroundUrlRef.current = url;
    setBackgroundImage({ name: file.name, url });
    setMessage('Plano de fundo adicionado.');
  }

  function clearBackground() {
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
    backgroundUrlRef.current = null;
    setBackgroundImage(null);
  }

  function addOverlayVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('video/')) {
      setMessage('Escolha um vídeo MP4, MOV ou WebM.');
      return;
    }
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    const url = registerUrl(URL.createObjectURL(file));
    videoUrlRef.current = url;
    setOverlayVideo({ name: file.name, url });
    setSelectedLayer('video');
    setMessage('Vídeo adicionado. Arraste-o no canvas para posicionar.');
  }

  function clearOverlayVideo() {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
    setOverlayVideo(null);
    setSelectedLayer((currentLayer) => (currentLayer === 'video' ? null : currentLayer));
  }

  function isLayerAvailable(layer: CanvasLayer) {
    if (layer === 'video') return Boolean(overlayVideo);
    if (layer === 'image') return Boolean(selectedAsset);
    return visibleTextLayers[layer];
  }

  function updateLayerPosition(layer: CanvasLayer, position: Position) {
    setPositions((currentPositions) => ({ ...currentPositions, [layer]: position }));
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const layer = target.closest<HTMLElement>('[data-feed-layer]')?.dataset.feedLayer as CanvasLayer | undefined;
    if (!layer || !canvasRef.current) return;
    dragLayerRef.current = layer;
    setSelectedLayer(layer);
    canvasRef.current.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const layer = dragLayerRef.current;
    if (!layer || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    updateLayerPosition(layer, {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * 100),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * 100),
    });
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragLayerRef.current = null;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId);
  }

  function resetSelectedLayer() {
    if (selectedLayer) updateLayerPosition(selectedLayer, selectedLayer === 'headline' ? { x: 50, y: 35 } : selectedLayer === 'support' ? { x: 50, y: 53 } : selectedLayer === 'footer' ? { x: 50, y: 82 } : { x: 50, y: 50 });
  }

  function togglePost(postId: string) {
    setBulkPosts((currentPosts) => currentPosts.map((post) => (post.id === postId ? { ...post, selected: !post.selected } : post)));
  }

  function updateCaption(postId: string, caption: string) {
    setBulkPosts((currentPosts) => currentPosts.map((post) => (post.id === postId ? { ...post, caption } : post)));
  }

  function removePost(postId: string) {
    setBulkPosts((currentPosts) => currentPosts.filter((post) => post.id !== postId));
  }

  function preparePosts() {
    if (selectedPosts.length === 0) {
      setMessage('Selecione ao menos um post para preparar a fila.');
      return;
    }
    setBulkPosts((currentPosts) => currentPosts.map((post) => (post.selected ? { ...post, status: 'Pronto' } : post)));
    setMessage(`${selectedPosts.length} publicação(ões) preparadas para ${publishDate}.`);
  }

  const canvasStyle = {
    '--studio-accent': accent,
    '--canvas-background': backgroundColor,
    '--studio-text': template === 'promo' ? '#121a1a' : '#f8fafc',
  } as CSSProperties;
  const selectedPosition = selectedLayer ? positions[selectedLayer] : null;

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace studio-page social-studio">
        <div className="studio-topbar workflow-heading">
          <div>
            <p className="eyebrow">Estúdio social</p>
            <h1>Monte seu feed do seu jeito.</h1>
            <p className="studio-lede">Comece com um canvas livre. Adicione apenas o que quiser, arraste cada camada e depois leve suas imagens para a fila de posts.</p>
          </div>
          <div className="studio-status"><span className="studio-live-dot" /><span>Workspace local</span><button type="button" className="secondary-action">Conectar Instagram</button></div>
        </div>

        <div className="studio-tabs" role="tablist" aria-label="Sessões do estúdio social">
          <button type="button" role="tab" aria-selected={activeTab === 'layout'} className={activeTab === 'layout' ? 'active' : ''} onClick={() => setActiveTab('layout')}><LayoutTemplate size={17} /> Montar layout <span>01</span></button>
          <button type="button" role="tab" aria-selected={activeTab === 'bulk'} className={activeTab === 'bulk' ? 'active' : ''} onClick={() => setActiveTab('bulk')}><Send size={17} /> Publicar em massa <span>{bulkPosts.length.toString().padStart(2, '0')}</span></button>
        </div>

        {activeTab === 'layout' ? (
          <div className="social-layout-grid">
            <section className="social-inspector studio-card">
              <div className="studio-card-heading"><div><span className="studio-kicker">Canvas livre</span><h2>Monte as camadas</h2></div><span className="studio-card-icon"><Palette size={18} /></span></div>

              <div className="inspector-group">
                <div className="inspector-label-row"><span>Formato do feed</span><strong>{format === 'portrait' ? '4:5' : '1:1'}</strong></div>
                <div className="format-toggle"><button type="button" className={format === 'portrait' ? 'active' : ''} onClick={() => setFormat('portrait')}><span className="format-glyph portrait" />Retrato <small>1080 × 1350</small></button><button type="button" className={format === 'square' ? 'active' : ''} onClick={() => setFormat('square')}><span className="format-glyph square" />Quadrado <small>1080 × 1080</small></button></div>
              </div>

              <div className="inspector-group">
                <div className="inspector-label-row"><span>Template base</span><span className="subtle-label">opcional</span></div>
                <div className="template-list">
                  <button type="button" className={template === null ? 'active' : ''} onClick={() => updateTemplate(null)}><span className="template-swatch template-swatch-free" /><span><strong>Sem template</strong><small>Canvas totalmente livre</small></span>{template === null && <Check size={15} />}</button>
                  {templateOptions.map((option) => <button type="button" key={option.id} className={template === option.id ? 'active' : ''} onClick={() => updateTemplate(option.id)}><span className="template-swatch" style={{ background: option.accent }} /><span><strong>{option.label}</strong><small>{option.description}</small></span>{template === option.id && <Check size={15} />}</button>)}
                </div>
              </div>

              <div className="inspector-group">
                <div className="inspector-label-row"><span>Camadas opcionais</span><span className="subtle-label">{layerCount} adicionada(s)</span></div>
                <div className="layer-toggle-list">
                  <button type="button" className={`layer-toggle ${overlayVideo ? 'active' : ''}`} onClick={() => overlayVideo ? setSelectedLayer('video') : setMessage('Adicione um vídeo para ativar esta camada.')}><span className="layer-toggle-icon video-layer-icon"><Video size={14} /></span><span><strong>Vídeo</strong><small>{overlayVideo?.name || 'Adicionar arquivo de vídeo'}</small></span>{overlayVideo ? <Check size={15} /> : <Plus size={15} />}</button>
                  <button type="button" className={`layer-toggle ${selectedAsset ? 'active' : ''}`} onClick={() => selectedAsset ? setSelectedLayer('image') : setMessage('Adicione uma imagem para ativar esta camada.')}><span className="layer-toggle-icon image-layer-icon"><ImagePlus size={14} /></span><span><strong>Imagem</strong><small>{selectedAsset?.name || 'Logo, foto ou sticker'}</small></span>{selectedAsset ? <Check size={15} /> : <Plus size={15} />}</button>
                  {textLayerOptions.map((layer) => <button type="button" key={layer.id} className={`layer-toggle ${visibleTextLayers[layer.id] ? 'active' : ''}`} onClick={() => toggleTextLayer(layer.id)}><span className="layer-toggle-icon text-layer-icon"><Type size={14} /></span><span><strong>{layer.label}</strong><small>{visibleTextLayers[layer.id] ? 'Visível no canvas' : layer.description}</small></span>{visibleTextLayers[layer.id] ? <Check size={15} /> : <Plus size={15} />}</button>)}
                </div>
              </div>

              {Object.entries(visibleTextLayers).some(([, visible]) => visible) && <div className="inspector-group"><div className="inspector-label-row"><span><Type size={14} /> Texto</span><span className="subtle-label">arraste no canvas</span></div>{textLayerOptions.filter((layer) => visibleTextLayers[layer.id]).map((layer) => <label className="studio-field" key={layer.id}><span>{layer.label}</span><textarea rows={2} maxLength={layer.id === 'headline' ? 66 : layer.id === 'support' ? 118 : 48} placeholder={`Digite o ${layer.label.toLowerCase()} (opcional)`} value={getTextLayerValue(layer.id)} onChange={(event) => updateTextLayer(layer.id, event.target.value)} /></label>)}</div>}

              <div className="inspector-group"><div className="inspector-label-row"><span>Plano de fundo</span><span className="subtle-label">opcional</span></div><label className="studio-field"><span>Cor do canvas</span><span className="color-input"><input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /><strong>{backgroundColor.toUpperCase()}</strong></span></label><label className="upload-asset-button"><Upload size={15} /> Adicionar imagem de fundo <input type="file" accept="image/png,image/jpeg,image/webp" onChange={addBackground} /></label>{backgroundImage && <div className="current-asset-row"><span>{backgroundImage.name}</span><button type="button" className="icon-button" aria-label="Remover plano de fundo" onClick={clearBackground}><Trash2 size={14} /></button></div>}</div>

              <div className="inspector-group"><div className="inspector-label-row"><span>Mídia do canvas</span><span className="subtle-label">tudo opcional</span></div><label className="upload-asset-button"><ImagePlus size={15} /> Adicionar imagens <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={addAssets} /></label><label className="upload-asset-button"><Video size={15} /> Adicionar vídeo <input type="file" accept="video/*" onChange={addOverlayVideo} /></label>{assets.length > 0 && <div className="asset-strip">{assets.map((asset) => <div className={`asset-chip ${asset.id === selectedAssetId ? 'active' : ''}`} key={asset.id}><button type="button" onClick={() => { setSelectedAssetId(asset.id); setSelectedLayer('image'); }}><img src={asset.url} alt="" /><span title={asset.name}>{asset.name}</span></button><button type="button" aria-label={`Remover ${asset.name}`} onClick={() => removeAsset(asset.id)}><Trash2 size={13} /></button></div>)}</div>}{overlayVideo && <div className="current-asset-row"><span title={overlayVideo.name}>{overlayVideo.name}</span><button type="button" className="icon-button" aria-label="Remover vídeo" onClick={clearOverlayVideo}><Trash2 size={14} /></button></div>}</div>

              {selectedLayer && selectedPosition && isLayerAvailable(selectedLayer) && <div className="inspector-group position-group"><div className="inspector-label-row"><span>Posição da camada</span><button type="button" className="secondary-action position-reset" onClick={resetSelectedLayer}>Resetar</button></div><div className="position-fields"><label className="studio-field"><span>X (%)</span><input type="number" min="3" max="97" value={Math.round(selectedPosition.x)} onChange={(event) => updateLayerPosition(selectedLayer, { ...selectedPosition, x: clamp(Number(event.target.value)) })} /></label><label className="studio-field"><span>Y (%)</span><input type="number" min="3" max="97" value={Math.round(selectedPosition.y)} onChange={(event) => updateLayerPosition(selectedLayer, { ...selectedPosition, y: clamp(Number(event.target.value)) })} /></label></div>{(selectedLayer === 'image' || selectedLayer === 'video') && <label className="range-control"><span>Tamanho <strong>{mediaScale}%</strong></span><input type="range" min="15" max="100" value={mediaScale} onChange={(event) => setMediaScale(Number(event.target.value))} /></label>}</div>}

              <div className="inspector-group inspector-inline-group"><label className="studio-field"><span>Alinhamento do texto</span><span className="align-control"><button type="button" className={align === 'left' ? 'active' : ''} onClick={() => setAlign('left')} aria-label="Alinhar à esquerda"><AlignLeft size={16} /></button><button type="button" className={align === 'center' ? 'active' : ''} onClick={() => setAlign('center')} aria-label="Alinhar ao centro"><span className="align-center-glyph" /></button></span></label><label className="studio-field"><span>Cor de destaque</span><span className="color-input"><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /><strong>{accent.toUpperCase()}</strong></span></label></div>
              <div className="inspector-tip"><Sparkles size={15} /><p>Nada é obrigatório: você pode usar apenas fundo, apenas vídeo, ou combinar quantas camadas quiser.</p></div>
            </section>

            <section className="social-preview-column"><div className="preview-header"><div><span className="studio-kicker">Preview ao vivo</span><h2>Feed / {format === 'portrait' ? 'Retrato 4:5' : 'Quadrado 1:1'}</h2></div><span className="preview-meta">{template ? activeTemplate?.label : 'Sem template'} <span>·</span> {layerCount} camada(s)</span></div><div className="feed-canvas-wrap"><div className={`feed-canvas ${format} template-${template || 'none'}`} style={canvasStyle} ref={canvasRef} onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp} onPointerCancel={handleCanvasPointerUp}>{backgroundImage && <img className="feed-canvas-background" src={backgroundImage.url} alt="" />}{overlayVideo && <video className={`feed-canvas-video ${selectedLayer === 'video' ? 'selected' : ''}`} data-feed-layer="video" src={overlayVideo.url} muted autoPlay loop playsInline style={{ left: `${positions.video.x}%`, top: `${positions.video.y}%`, width: `${mediaScale}%` }} />}{selectedAsset && <img className={`feed-canvas-image-layer ${selectedLayer === 'image' ? 'selected' : ''}`} data-feed-layer="image" src={selectedAsset.url} alt="Imagem do layout" style={{ left: `${positions.image.x}%`, top: `${positions.image.y}%`, width: `${mediaScale}%` }} />}{template && <><div className="feed-canvas-shade" /><div className="feed-canvas-grid" /></>}{visibleTextLayers.headline && headline && <div className={`feed-canvas-text-layer feed-text-headline ${selectedLayer === 'headline' ? 'selected' : ''}`} data-feed-layer="headline" style={{ left: `${positions.headline.x}%`, top: `${positions.headline.y}%`, textAlign: align }}>{headline}<span className="feed-layer-grip"><Move size={11} /></span></div>}{visibleTextLayers.support && support && <div className={`feed-canvas-text-layer feed-text-support ${selectedLayer === 'support' ? 'selected' : ''}`} data-feed-layer="support" style={{ left: `${positions.support.x}%`, top: `${positions.support.y}%`, textAlign: align }}>{support}<span className="feed-layer-grip"><Move size={11} /></span></div>}{visibleTextLayers.footer && footer && <div className={`feed-canvas-text-layer feed-text-footer ${selectedLayer === 'footer' ? 'selected' : ''}`} data-feed-layer="footer" style={{ left: `${positions.footer.x}%`, top: `${positions.footer.y}%`, textAlign: align }}>{footer}<span className="feed-layer-grip"><Move size={11} /></span></div>}{!backgroundImage && !overlayVideo && !selectedAsset && !headline && !support && !footer && <div className="feed-canvas-placeholder"><Plus size={25} /><span>Canvas vazio<br />adicione apenas o que quiser</span></div>}{template && <span className="feed-canvas-accent" />}</div></div><div className="preview-footer"><div><span className="preview-dot" /><span>Atualizado agora</span></div><span>{selectedLayer ? 'Camada selecionada · arraste para posicionar' : 'Selecione uma camada para editar'}</span></div></section>

            <aside className="social-checklist studio-card"><div className="studio-card-heading"><div><span className="studio-kicker">Liberdade de criação</span><h2>Você decide</h2></div><span className="completion-ring">{layerCount.toString().padStart(2, '0')}</span></div><div className="checklist-list"><div className="checklist-item done"><span><Check size={13} /></span><div><strong>Formato do canvas</strong><small>Feed {format === 'portrait' ? '4:5' : '1:1'}</small></div></div><div className="checklist-item done"><span><Check size={13} /></span><div><strong>Template base</strong><small>{template ? activeTemplate?.label : 'Sem template · livre'}</small></div></div><div className="checklist-item"><span><span className="checklist-number">+</span></span><div><strong>Elementos opcionais</strong><small>Vídeo, imagem e textos entram quando você quiser</small></div></div><div className="checklist-item"><span><span className="checklist-number">→</span></span><div><strong>Fila de posts</strong><small>Adicione imagens e revise as legendas</small></div></div></div><button type="button" className="primary-action" onClick={() => setActiveTab('bulk')}><Send size={16} /> Ir para publicações <span>→</span></button></aside>
          </div>
        ) : (
          <div className="bulk-layout"><section className="bulk-toolbar studio-card"><div className="bulk-toolbar-copy"><span className="studio-kicker">Fila de conteúdo</span><h2>{selectedPosts.length} de {bulkPosts.length} posts selecionados</h2><p>Aplique o layout livre, revise cada legenda e deixe tudo pronto para publicar.</p></div><div className="bulk-toolbar-actions"><label className="schedule-field"><span>Publicar</span><select value={publishDate} onChange={(event) => setPublishDate(event.target.value)}><option>Hoje, 18:30</option><option>Amanhã, 09:00</option><option>Sexta, 12:00</option><option>Escolher data...</option></select></label><button type="button" className="primary-action" onClick={preparePosts}><Send size={16} /> Preparar fila</button></div></section><section className="bulk-main-grid"><div className="bulk-posts-panel studio-card"><div className="studio-card-heading"><div><span className="studio-kicker">Revisão em lote</span><h2>Publicações do pacote</h2></div><label className="icon-button" aria-label="Adicionar mais imagens"><Plus size={17} /><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={addAssets} /></label></div><div className="bulk-posts-grid">{bulkPosts.map((post, index) => <article className={`bulk-post-card ${post.selected ? 'selected' : ''}`} key={post.id}><div className="bulk-post-visual">{post.imageUrl ? <img src={post.imageUrl} alt="" /> : <div className="bulk-post-placeholder"><LayoutTemplate size={19} /><span>Imagem {String(index + 1).padStart(2, '0')}</span></div>}<label className="bulk-post-check"><input type="checkbox" checked={post.selected} onChange={() => togglePost(post.id)} /><span><Check size={13} /></span></label><span className={`bulk-post-status ${post.status === 'Pronto' ? 'ready' : ''}`}>{post.status}</span><span className="bulk-post-number">{String(index + 1).padStart(2, '0')}</span></div><div className="bulk-post-copy"><div className="bulk-post-title"><strong>{post.title}</strong><button type="button" aria-label={`Remover ${post.title}`} onClick={() => removePost(post.id)}><Trash2 size={14} /></button></div><textarea value={post.caption} aria-label={`Legenda de ${post.title}`} rows={3} placeholder="Legenda opcional" onChange={(event) => updateCaption(post.id, event.target.value)} /><div className="bulk-post-meta"><span>{post.caption.length}/2200</span><button type="button" onClick={() => setMessage(`Legenda de ${post.title} duplicada no clipboard visual.`)}><Copy size={13} /> Duplicar</button></div></div></article>)}<label className="bulk-add-card"><Plus size={23} /><strong>Adicionar imagens</strong><span>JPG, PNG ou WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={addAssets} /></label></div></div><aside className="bulk-summary-column"><div className="bulk-summary studio-card"><div className="studio-card-heading"><div><span className="studio-kicker">Resumo da fila</span><h2>Pacote Instagram</h2></div><Camera size={20} /></div><div className="summary-stat"><span>Posts selecionados</span><strong>{selectedPosts.length.toString().padStart(2, '0')}</strong></div><div className="summary-stat"><span>Formato</span><strong>{format === 'portrait' ? '4:5' : '1:1'}</strong></div><div className="summary-stat"><span>Template</span><strong>{activeTemplate?.label || 'Livre'}</strong></div><div className="summary-divider" /><div className="summary-note"><span className="summary-note-icon"><Check size={14} /></span><p>O layout é opcional: cada post pode ter somente a imagem e a legenda que você escolher.</p></div><button type="button" className="secondary-action" onClick={() => setActiveTab('layout')}><LayoutTemplate size={15} /> Ajustar layout</button></div><div className="bulk-connection studio-card"><div className="connection-mark"><Camera size={18} /></div><div><strong>Conta do Instagram</strong><p>Conecte quando quiser publicar direto. Por enquanto, a fila fica pronta no seu workspace.</p></div><button type="button" className="secondary-action" onClick={() => setMessage('A conexão com o Instagram ficará disponível na próxima etapa do projeto.')}>Saiba mais</button></div></aside></section></div>
        )}

        {message && <div className="studio-toast" role="status"><Check size={16} /> {message}<button type="button" aria-label="Fechar mensagem" onClick={() => setMessage('')}>×</button></div>}
      </section>
    </main>
  );
}
