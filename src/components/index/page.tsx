import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  AudioLines,
  Bell,
  Clock3,
  Download,
  Film,
  ListVideo,
  MoreHorizontal,
  Pencil,
  Play,
  ScanFace,
  Search,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import {
  analyzeUploadedVideo,
  createProject,
  exportClipsToGallery,
  generateVideoClips,
  getUploadedVideo,
  GeneratedClip,
  listUploadedVideos,
  UploadedVideo,
  uploadAudioAsset,
  VoiceoverAsset,
} from '../../lib/videoApi';
import { subtitleFonts } from '../../lib/subtitleFonts';
import { captionStylePresets, getCaptionStylePreset, toCaptionSettings } from '../../lib/captionPresets';
import type { CaptionEffect } from '../../features/editor/domain/editor.types';
import { formatDuration, formatMinutes } from '../../lib/formatters';
import {
  getMaxClipCount,
  MIN_CLIP_COUNT,
  MIN_CLIP_DURATION_SECONDS,
} from '../../lib/videoRules';
import { Header } from '../main/Header';
import { useNavigate } from 'react-router-dom';

export function IndexPage() {
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [cutMode, setCutMode] = useState<'duration' | 'count' | 'recommended' | 'best-moments'>('count');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [targetClipDurationSeconds, setTargetClipDurationSeconds] = useState(45);
  const [targetClipCount, setTargetClipCount] = useState(5);
  const [subtitleMode, setSubtitleMode] = useState<'none' | 'automatic' | 'manual'>('automatic');
  const [manualSubtitleText, setManualSubtitleText] = useState('');
  const [subtitleCorrections, setSubtitleCorrections] = useState('');
  const [subtitleFont, setSubtitleFont] = useState(subtitleFonts[0].id);
  const [subtitlePosition, setSubtitlePosition] = useState<'bottom' | 'middle' | 'top'>('bottom');
  const [subtitleDisplayMode, setSubtitleDisplayMode] = useState<'block' | 'word'>('block');
  const [subtitleLanguage, setSubtitleLanguage] = useState<'original' | 'pt-BR'>('pt-BR');
  const [subtitleStylePreset, setSubtitleStylePreset] = useState(captionStylePresets[0].id);
  const [subtitleEffect, setSubtitleEffect] = useState<CaptionEffect>(captionStylePresets[0].effect);
  const [audioEnhancement, setAudioEnhancement] = useState(false);
  const [removeSilence, setRemoveSilence] = useState(false);
  const [removeFillers, setRemoveFillers] = useState(false);
  const [voiceoverAsset, setVoiceoverAsset] = useState<VoiceoverAsset | null>(null);
  const [isUploadingVoiceover, setIsUploadingVoiceover] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [openingClipId, setOpeningClipId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listUploadedVideos()
      .then((loadedVideos) => {
        setVideos(loadedVideos);
        setSelectedVideoId(loadedVideos[0]?.id || '');
      })
      .catch(() => setMessage('Nao foi possivel carregar os videos da pagina Arquivos.'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedVideoId) {
      return;
    }

    let isCurrent = true;
    getUploadedVideo(selectedVideoId)
      .then((loadedVideo) => {
        if (isCurrent) {
          replaceVideo(loadedVideo);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setMessage('Nao foi possivel carregar os detalhes do video selecionado.');
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedVideoId]);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) || null,
    [selectedVideoId, videos],
  );

  const clips = useMemo(() => selectedVideo?.clips || [], [selectedVideo]);
  const selectedClips = clips.filter((clip) => selectedClipIds.includes(clip.id));

  useEffect(() => {
    if (cutMode === 'recommended' && !(selectedVideo?.audienceRecommendations?.length || 0)) {
      setCutMode('count');
    }
  }, [cutMode, selectedVideo]);

  useEffect(() => {
    const availableClipIds = clips.map((clip) => clip.id);
    setSelectedClipIds((currentIds) => {
      const filteredIds = currentIds.filter((id) => availableClipIds.includes(id));
      return filteredIds.length > 0 ? filteredIds : availableClipIds;
    });
  }, [selectedVideoId, clips]);

  const maxClipCount = Math.max(MIN_CLIP_COUNT, getMaxClipCount(Number(selectedVideo?.durationSeconds || 0)));
  const maxClipDurationSeconds = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.floor(Number(selectedVideo?.durationSeconds || MIN_CLIP_DURATION_SECONDS)),
  );
  const safeTargetClipDurationSeconds = Math.min(
    maxClipDurationSeconds,
    Math.max(MIN_CLIP_DURATION_SECONDS, Math.round(targetClipDurationSeconds || 0)),
  );
  const safeTargetClipCount = Math.min(
    maxClipCount,
    Math.max(MIN_CLIP_COUNT, Math.round(targetClipCount || 0)),
  );
  const generateButtonLabel =
    cutMode === 'count'
      ? `Criar ${safeTargetClipCount} rascunhos`
      : cutMode === 'recommended'
        ? 'Criar momentos recomendados'
        : cutMode === 'best-moments'
          ? 'Criar melhores momentos'
        : 'Criar rascunhos';

  const selectedCaptionPreset = getCaptionStylePreset(subtitleStylePreset);

  function replaceVideo(updatedVideo: UploadedVideo) {
    setVideos((currentVideos) =>
      currentVideos.map((currentVideo) => (currentVideo.id === updatedVideo.id ? updatedVideo : currentVideo)),
    );
  }

  async function analyzeSelectedVideo() {
    if (!selectedVideo) {
      setMessage('Selecione um video salvo em Arquivos antes de analisar.');
      return null;
    }

    try {
      setIsAnalyzing(true);
      setMessage('Analisando fala, movimento e rostos para encontrar os melhores momentos...');
      const analyzedVideo = await analyzeUploadedVideo(selectedVideo.id, (job) => {
        setMessage(job.status === 'queued'
          ? 'Analise de IA entrou na fila...'
          : `Analisando fala, movimento e rostos... ${job.progress}%`);
      });
      replaceVideo(analyzedVideo);
      setMessage('Analise concluida. O rastreamento facial sera aplicado automaticamente ao reenquadrar os cortes.');
      return analyzedVideo;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel analisar o video.');
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function createClips() {
    if (!selectedVideo) {
      setMessage('Selecione um video salvo em Arquivos antes de gerar os clipes.');
      return;
    }

    if (selectedVideo.durationSeconds < MIN_CLIP_DURATION_SECONDS) {
      setMessage(`O video precisa ter pelo menos ${MIN_CLIP_DURATION_SECONDS} segundos para gerar cortes.`);
      return;
    }

    try {
      let videoForGeneration = selectedVideo;
      if (!selectedVideo.analysis) {
        const analyzedVideo = await analyzeSelectedVideo();
        if (!analyzedVideo) {
          return;
        }
        videoForGeneration = analyzedVideo;
      }
      setIsGenerating(true);
      setMessage('');
      const { video, clips: generatedClips } = await generateVideoClips(videoForGeneration.id, {
        mode: cutMode,
        targetDurationSeconds: safeTargetClipDurationSeconds,
        targetClipCount: safeTargetClipCount,
        focusPrompt: focusPrompt.trim(),
      });
      replaceVideo(video);
      setSelectedClipIds(generatedClips.map((clip) => clip.id));
      setMessage('Rascunhos criados. Abra um corte no Editor antes de exportar.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel gerar os clipes.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function openClipEditor(_clip: GeneratedClip) {
    if (!selectedVideo) {
      return;
    }

    try {
      setOpeningClipId(_clip.id);
      setMessage('Abrindo o editor de layout...');
      const project = await createProject({
        videoId: selectedVideo.id,
        clipIds: [_clip.id],
      });
      const composition = project.compositions[0];
      if (!composition) {
        throw new Error('Composicao nao criada.');
      }
      navigate(`/projetos/${project.id}/cortes/${composition.id}/editor`);
    } catch {
      setMessage('Nao foi possivel abrir o corte no Editor.');
    } finally {
      setOpeningClipId(null);
    }
  }

  async function exportPackage() {
    if (!selectedVideo || selectedClipIds.length === 0) {
      setMessage('Selecione pelo menos um clipe para exportar.');
      return;
    }

    if (subtitleMode === 'manual' && !manualSubtitleText.trim()) {
      setMessage('Digite a legenda manual antes de exportar.');
      return;
    }

    try {
      setIsExporting(true);
      setMessage('');
      const exportJob = await exportClipsToGallery({
        videoId: selectedVideo.id,
        clipIds: selectedClipIds,
        subtitleMode,
        manualSubtitleText,
        subtitleCorrections,
        subtitleFont,
        subtitlePosition,
        subtitleDisplayMode,
        subtitleLanguage,
        audioMode: 'Audio original',
        audioEnhancement,
        removeSilence,
        removeFillers,
        voiceoverAsset,
        captionSettings: {
          mode: subtitleMode,
          manualText: manualSubtitleText,
          corrections: subtitleCorrections,
          position: subtitlePosition,
          language: subtitleLanguage,
          ...toCaptionSettings({
            ...selectedCaptionPreset,
            effect: subtitleEffect,
            font: subtitleFont,
            displayMode: subtitleDisplayMode,
          }),
        },
      });
      setMessage('Exportacao adicionada a fila.');
      navigate(`/galeria?jobId=${exportJob.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel exportar o pacote.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleVoiceoverUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setIsUploadingVoiceover(true);
      setMessage('Enviando voice-over...');
      const asset = await uploadAudioAsset(file);
      setVoiceoverAsset(asset);
      setMessage('Voice-over pronto para a próxima exportação.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel enviar o voice-over.');
    } finally {
      setIsUploadingVoiceover(false);
      event.target.value = '';
    }
  }

  function toggleClipSelection(clipId: string) {
    setSelectedClipIds((currentIds) =>
      currentIds.includes(clipId)
        ? currentIds.filter((currentId) => currentId !== clipId)
        : [...currentIds, clipId],
    );
  }

  function renderClipCard(clip: GeneratedClip) {
    const isSelected = selectedClipIds.includes(clip.id);

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
          {clip.recommendationScore !== undefined && (
            <small className="clip-ai-score">
              <Sparkles size={12} /> Score IA {Math.round(clip.recommendationScore)}%
            </small>
          )}
          {clip.recommendationReason && (
            <small className="clip-ai-reason">{clip.recommendationReason}</small>
          )}
          {clip.recommendationPrompt && (
            <small className="clip-ai-reason">Foco editorial: {clip.recommendationPrompt}</small>
          )}
        </div>
        <div className="clip-meta">
          <span className={`status ${clip.status.toLowerCase()}`}>{clip.status}</span>
          <button
            className="clip-editor-action"
            type="button"
            disabled={openingClipId === clip.id}
            onClick={() => void openClipEditor(clip)}
          >
            <Pencil size={13} />
            {openingClipId === clip.id ? 'Abrindo...' : 'Editar'}
          </button>
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
                <button className="icon-button" type="button" aria-label="Notificacoes">
              <Bell size={18} />
            </button>
          </div>
        </header>

        <div className="content-grid">
          <section className="generator-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Centro de produção</p>
                <h1>Crie cortes prontos para revisar</h1>
                <p className="panel-heading-description">Escolha um vídeo, defina o ritmo dos cortes e prepare as legendas em um só lugar.</p>
              </div>
            </div>

            <div className="dropzone video-selector">
              <div className="upload-symbol">
                <ListVideo size={28} />
              </div>
              <div>
                <h2>Selecione um video dos Arquivos</h2>
                <p>Use o video ja estruturado no Editor para fechar as legendas dos cortes.</p>
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
                <span>Modo de corte</span>
                <select
                  aria-label="Modo de corte"
                  value={cutMode}
                  onChange={(event) => setCutMode(event.target.value as 'duration' | 'count' | 'recommended' | 'best-moments')}
                >
                  <option value="duration">Duracao por corte</option>
                  <option value="count">Quantidade de cortes</option>
                  <option value="best-moments">Melhores momentos com IA</option>
                  {selectedVideo?.audienceRecommendations?.length ? <option value="recommended">Momentos mais assistidos</option> : null}
                </select>
              </label>
            {cutMode === 'duration' ? (
                <label className="setting-control">
                  <span>Duracao minima de cada corte</span>
                  <input
                    aria-label="Duracao de cada corte em segundos"
                    min={MIN_CLIP_DURATION_SECONDS}
                    max={maxClipDurationSeconds}
                    step={5}
                    type="number"
                    value={safeTargetClipDurationSeconds}
                    onChange={(event) => setTargetClipDurationSeconds(Number(event.target.value))}
                  />
                </label>
              ) : cutMode === 'count' ? (
                <label className="setting-control">
                  <span>Quantidade de cortes</span>
                  <input
                    aria-label="Quantidade de cortes"
                    min={MIN_CLIP_COUNT}
                    max={maxClipCount}
                    step={1}
                    type="number"
                    value={safeTargetClipCount}
                    onChange={(event) => setTargetClipCount(Number(event.target.value))}
                  />
                </label>
              ) : cutMode === 'best-moments' ? (
                <div className="setting-control setting-control-recommendation">
                  <span>Analise inteligente</span>
                  <strong>{selectedVideo?.aiStatus === 'done' ? 'Fala, movimento e rosto analisados' : 'Analise automatica ao gerar'}</strong>
                </div>
              ) : (
                <div className="setting-control setting-control-recommendation">
                  <span>Recomendacao do YouTube</span>
                  <strong>{selectedVideo?.audienceRecommendations?.length || 0} janela(s) recomendada(s)</strong>
                </div>
              )}
            </div>

            <p className="generator-limit-note">
              {cutMode === 'recommended'
                ? 'As janelas foram escolhidas a partir dos momentos mais assistidos disponíveis no YouTube.'
                : `Cada corte terá no mínimo ${MIN_CLIP_DURATION_SECONDS} segundos e pode passar de 1 minuto quando o melhor momento exigir. Este vídeo permite até ${Math.floor(Number(selectedVideo?.durationSeconds || 0) / MIN_CLIP_DURATION_SECONDS)} corte(s) sem ultrapassar o tempo disponível.`}
            </p>

            {cutMode === 'best-moments' && (
              <label className="setting-control prompt-control">
                <span>Pedido editorial opcional</span>
                <input
                  aria-label="Pedido editorial para encontrar melhores momentos"
                  placeholder="Ex.: trecho mais engraçado sobre vendas"
                  value={focusPrompt}
                  onChange={(event) => setFocusPrompt(event.target.value)}
                />
                <small>As palavras do pedido recebem mais peso na ordenação das sugestões.</small>
              </label>
            )}

            {cutMode === 'best-moments' && (
              <p className="generator-ai-note">
                A IA combina fala, ganchos de texto, movimento e presenca de rosto para ordenar as janelas mais promissoras.
              </p>
            )}

            <div className="generator-actions">
              <button className="generate-button" disabled={!selectedVideo || isGenerating || isAnalyzing} onClick={createClips}>
                <Wand2 size={20} />
                {isGenerating ? 'Gerando clips...' : generateButtonLabel}
              </button>
              <button className="secondary-action analysis-action" type="button" disabled={!selectedVideo || isAnalyzing || isGenerating} onClick={() => void analyzeSelectedVideo()}>
                <ScanFace size={17} />
                {isAnalyzing ? 'Analisando...' : 'Analisar video'}
              </button>
            </div>
            <div className="tracking-note">
              <ScanFace size={16} />
              <span>Tracking de rosto automatico: o reenquadramento acompanha o rosto principal durante o corte.</span>
            </div>

            {selectedVideo?.analysis?.brollSuggestions?.length ? (
              <section className="broll-suggestions" aria-labelledby="broll-suggestions-title">
                <div className="broll-suggestions-heading">
                  <div>
                    <p className="eyebrow">Apoio visual</p>
                    <h2 id="broll-suggestions-title">Sugestões de B-roll</h2>
                  </div>
                  <span>{selectedVideo.analysis.brollSuggestions.length} ideias</span>
                </div>
                <p>Use estas ideias como guia para adicionar imagens ou vídeos de apoio no Editor.</p>
                <div className="broll-suggestion-list">
                  {selectedVideo.analysis.brollSuggestions.slice(0, 6).map((suggestion) => (
                    <article className="broll-suggestion" key={suggestion.id}>
                      <span>{formatDuration(suggestion.startSeconds)}–{formatDuration(suggestion.endSeconds)}</span>
                      <strong>{suggestion.title}</strong>
                      <small>{suggestion.prompt}</small>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="subtitle-settings">
              <div className="subtitle-settings-heading">
                <p className="eyebrow">Legenda</p>
                <h2>Configurar legenda dos cortes</h2>
              </div>

              <div className="settings-grid">
                <label className="setting-control">
                  <span>Tipo de legenda</span>
                  <select
                    aria-label="Tipo de legenda"
                    value={subtitleMode}
                    onChange={(event) => setSubtitleMode(event.target.value as 'none' | 'automatic' | 'manual')}
                  >
                    <option value="automatic">Legenda automatica</option>
                    <option value="manual">Legenda manual</option>
                    <option value="none">Sem legenda</option>
                  </select>
                </label>
                <label className="setting-control">
                  <span>Fonte gratuita</span>
                  <select
                    aria-label="Fonte da legenda"
                    value={subtitleFont}
                    onChange={(event) => setSubtitleFont(event.target.value)}
                    disabled={subtitleMode === 'none'}
                  >
                    {subtitleFonts.map((font) => (
                      <option value={font.id} key={font.id}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="settings-grid caption-presets-grid">
                <label className="setting-control">
                  <span>Preset de fonte e estilo</span>
                  <select
                    aria-label="Preset de fonte e estilo"
                    value={subtitleStylePreset}
                    onChange={(event) => {
                      const preset = getCaptionStylePreset(event.target.value);
                      setSubtitleStylePreset(preset.id);
                      setSubtitleFont(preset.font);
                      setSubtitleDisplayMode(preset.displayMode);
                      setSubtitleEffect(preset.effect);
                    }}
                    disabled={subtitleMode === 'none'}
                  >
                    {captionStylePresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>{preset.label} — {preset.description}</option>
                    ))}
                  </select>
                </label>
                <label className="setting-control">
                  <span>Efeito da legenda</span>
                  <select
                    aria-label="Efeito da legenda"
                    value={subtitleEffect}
                    onChange={(event) => {
                      const effect = event.target.value as CaptionEffect;
                      setSubtitleEffect(effect);
                      if (effect === 'karaoke' || effect === 'neon') {
                        setSubtitleDisplayMode('word');
                      }
                    }}
                    disabled={subtitleMode === 'none'}
                  >
                    <option value="none">Nenhum</option>
                    <option value="karaoke">Karaoke palavra a palavra</option>
                    <option value="boxed">Caixa de destaque</option>
                    <option value="neon">Neon com sombra</option>
                    <option value="shadow">Sombra suave</option>
                  </select>
                </label>
              </div>

              <label className="setting-control subtitle-position-control">
                <span>Posicao no video</span>
                <select
                  aria-label="Posicao da legenda"
                  value={subtitlePosition}
                  onChange={(event) => setSubtitlePosition(event.target.value as 'bottom' | 'middle' | 'top')}
                  disabled={subtitleMode === 'none'}
                >
                  <option value="bottom">Inferior</option>
                  <option value="middle">Centro</option>
                  <option value="top">Superior</option>
                </select>
              </label>

              <label className="setting-control subtitle-position-control">
                <span>Estilo da legenda</span>
                <select
                  aria-label="Estilo da legenda"
                  value={subtitleDisplayMode}
                  onChange={(event) => setSubtitleDisplayMode(event.target.value as 'block' | 'word')}
                  disabled={subtitleMode === 'none'}
                >
                  <option value="block">Em blocos</option>
                  <option value="word">Palavra a palavra</option>
                </select>
              </label>

              <label className="setting-control subtitle-position-control">
                <span>Idioma da legenda</span>
                <select
                  aria-label="Idioma da legenda"
                  value={subtitleLanguage}
                  onChange={(event) => setSubtitleLanguage(event.target.value as 'original' | 'pt-BR')}
                  disabled={subtitleMode === 'none'}
                >
                  <option value="pt-BR">Português (traduzida)</option>
                  <option value="original">Idioma original</option>
                </select>
              </label>

              {subtitleMode === 'manual' && (
                <label className="setting-control">
                  <span>Texto manual</span>
                  <textarea
                    aria-label="Texto da legenda manual"
                    placeholder="Digite a legenda que sera aplicada aos cortes selecionados"
                    value={manualSubtitleText}
                    onChange={(event) => setManualSubtitleText(event.target.value)}
                  />
                </label>
              )}

              {subtitleMode === 'automatic' && (
                <label className="setting-control">
                  <span>Corrigir palavras</span>
                  <textarea
                    aria-label="Correcoes da legenda automatica"
                    placeholder={'errado = correto\nRe bears = Recorda-me'}
                    value={subtitleCorrections}
                    onChange={(event) => setSubtitleCorrections(event.target.value)}
                  />
                </label>
              )}
            </div>

            <section className="smart-audio-settings" aria-labelledby="smart-audio-title">
              <div className="subtitle-settings-heading">
                <p className="eyebrow">Tratamento de áudio</p>
                <h2 id="smart-audio-title">Deixe a fala mais limpa</h2>
              </div>
              <div className="smart-audio-options">
                <label className="smart-audio-option">
                  <input type="checkbox" checked={audioEnhancement} onChange={(event) => setAudioEnhancement(event.target.checked)} />
                  <span><strong>Melhorar áudio</strong><small>Reduz ruído e normaliza o volume na exportação.</small></span>
                </label>
                <label className="smart-audio-option">
                  <input type="checkbox" checked={removeSilence} onChange={(event) => setRemoveSilence(event.target.checked)} />
                  <span><strong>Encurtar pausas longas</strong><small>Remove intervalos acima de 0,9s preservando uma respiração curta.</small></span>
                </label>
                <label className="smart-audio-option">
                  <input type="checkbox" checked={removeFillers} onChange={(event) => setRemoveFillers(event.target.checked)} />
                  <span><strong>Remover vícios de linguagem</strong><small>Retira palavras detectadas como “um”, “uh”, “tipo” e similares quando houver timestamps.</small></span>
                </label>
              </div>
              <div className="voiceover-upload">
                <AudioLines size={18} />
                <label className="voiceover-upload-control">
                  <strong>{voiceoverAsset ? 'Voice-over selecionado' : 'Adicionar voice-over'}</strong>
                  <small>{voiceoverAsset?.name || 'MP3, WAV, M4A, AAC, OGG ou FLAC'}</small>
                  <input type="file" accept="audio/*" onChange={handleVoiceoverUpload} disabled={isUploadingVoiceover} />
                </label>
                {voiceoverAsset && <button type="button" aria-label="Remover voice-over" onClick={() => setVoiceoverAsset(null)}><X size={15} /></button>}
              </div>
              <p className="smart-audio-note">O voice-over substitui o áudio original apenas no arquivo exportado. O preview original continua intacto.</p>
            </section>

            {message && <p className="generator-message">{message}</p>}
          </section>

          <div className="right-column">
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
            </section>

            <section className="clips-panel">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">Fila</p>
                  <h2>Cortes gerados</h2>
                </div>
                <button className="icon-button" type="button" aria-label="Mais opcoes">
                  <MoreHorizontal size={18} />
                </button>
              </div>

              <div className="clip-list">
                {clips.length > 0 ? (
                  clips.map(renderClipCard)
                ) : (
                  <div className="clip-empty">
                    <Film size={24} />
                    <span>Gere os cortes para revisar as legendas antes de enviar para a Galeria.</span>
                  </div>
                )}
              </div>
            </section>

            <section className="export-panel package-panel">
              <div className="export-copy">
                <Sparkles size={20} />
                <div>
                  <h2>Pacote pronto</h2>
                  <p>{selectedClips.length} clipes selecionados.</p>
                  <div className="package-list">
                    {selectedClips.map((clip) => (
                      <span key={clip.id}>{clip.title}</span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                className="secondary-action dark"
                type="button"
                disabled={!selectedVideo || selectedClipIds.length === 0 || isExporting}
                onClick={exportPackage}
              >
                <Download size={16} />
                {isExporting ? 'Exportando...' : 'Exportar'}
              </button>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
