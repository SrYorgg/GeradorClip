import { useEffect, useState } from 'react';
import { Folder, LoaderCircle, MonitorPlay, PackageOpen, RefreshCw, Subtitles, Volume2, XCircle } from 'lucide-react';
import { subtitleFonts } from '../../lib/subtitleFonts';
import {
  cancelExportJob,
  ExportJob,
  GalleryPackage,
  listExportJobs,
  listGalleryPackages,
  retryExportJob,
} from '../../lib/videoApi';
import { Header } from '../main/Header';
import { StepIndicator } from '../ui';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatPackageTitle(value: string) {
  return value.replace(/^Pacote - /, '');
}

function formatSubtitleMode(value: string) {
  const labels: Record<string, string> = {
    automatic: 'Legenda automatica',
    manual: 'Legenda manual',
    none: 'Sem legenda',
    'Legenda automatica': 'Legenda automatica',
    'Sem legenda': 'Sem legenda',
  };

  return labels[value] || value;
}

function formatSubtitlePosition(value: string) {
  const labels: Record<string, string> = {
    bottom: 'Inferior',
    middle: 'Centro',
    top: 'Superior',
  };

  return labels[value] || value;
}

function formatSubtitleFont(value: string) {
  return subtitleFonts.find((font) => font.id === value)?.label || value;
}

function formatJobStatus(value: ExportJob['status']) {
  const labels: Record<ExportJob['status'], string> = {
    queued: 'Na fila',
    running: 'Processando',
    succeeded: 'Concluido',
    failed: 'Falhou',
    cancelled: 'Cancelado',
  };

  return labels[value];
}

function formatJobPhase(value: ExportJob['phase']) {
  const labels: Record<ExportJob['phase'], string> = {
    preflight: 'Preparacao',
    captions: 'Legendas',
    render: 'Renderizacao',
    validate: 'Validacao',
    cleanup: 'Finalizacao',
  };

  return labels[value];
}

export function GalleryPage() {
  const [packages, setPackages] = useState<GalleryPackage[]>([]);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [jobActionId, setJobActionId] = useState('');

  useEffect(() => {
    let isCurrent = true;

    async function loadGalleryState(showLoading = false) {
      if (showLoading) {
        setIsLoading(true);
      }

      try {
        const [loadedPackages, loadedJobs] = await Promise.all([
          listGalleryPackages(),
          listExportJobs(),
        ]);
        if (!isCurrent) {
          return;
        }
        setPackages(loadedPackages);
        setJobs(loadedJobs);
        setError('');
      } catch {
        if (isCurrent) {
          setError('Nao foi possivel carregar a fila e os pacotes da galeria.');
        }
      } finally {
        if (isCurrent && showLoading) {
          setIsLoading(false);
        }
      }
    }

    void loadGalleryState(true);
    const refreshTimer = window.setInterval(() => {
      void loadGalleryState();
    }, 1500);

    return () => {
      isCurrent = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  async function handleCancel(jobId: string) {
    try {
      setJobActionId(jobId);
      const updatedJob = await cancelExportJob(jobId);
      setJobs((currentJobs) => currentJobs.map((job) => job.id === updatedJob.id ? updatedJob : job));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nao foi possivel cancelar o job.');
    } finally {
      setJobActionId('');
    }
  }

  async function handleRetry(jobId: string, clipId?: string) {
    try {
      setJobActionId(`${jobId}:${clipId || 'all'}`);
      const updatedJob = await retryExportJob(jobId, clipId);
      setJobs((currentJobs) => currentJobs.map((job) => job.id === updatedJob.id ? updatedJob : job));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Nao foi possivel repetir o job.');
    } finally {
      setJobActionId('');
    }
  }

  const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'running');

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="gallery-heading">
          <div>
            <p className="eyebrow">Etapa 6 de 6</p>
            <h1>Cortes armazenados</h1>
          </div>
          <span>{packages.length} pacotes exportados</span>
        </div>

        <StepIndicator currentStep={6} />

        {isLoading && <div className="route-panel">Carregando galeria...</div>}
        {error && <div className="route-panel">{error}</div>}

        {!isLoading && !error && (
          <section className="workflow-card export-jobs-panel">
            <div className="workflow-card-header">
              <div>
                <span className="eyebrow">Processamento</span>
                <h2>Fila de exportacao</h2>
                <p>Os jobs continuam no servidor mesmo se voce fechar esta tela.</p>
              </div>
              <strong className="export-jobs-count">{activeJobs.length} ativos</strong>
            </div>

            {jobs.length === 0 && <p className="workflow-field-help">Nenhuma exportacao foi iniciada.</p>}

            {jobs.length > 0 && (
              <div className="export-job-list">
                {jobs.map((job) => {
                  const succeededCount = job.clipResults.filter((clip) => clip.status === 'succeeded').length;
                  const failedClips = job.clipResults.filter((clip) => clip.status === 'failed' || clip.status === 'cancelled');
                  const canRetry = job.status === 'failed' || job.status === 'cancelled';
                  const isBusy = jobActionId === job.id;

                  return (
                    <article className={`export-job-card ${job.status}`} key={job.id}>
                      <div className="export-job-header">
                        <div>
                          <span className="eyebrow">{formatJobStatus(job.status)}</span>
                          <h3>{job.sourceName}</h3>
                          <p>{succeededCount} de {job.clipResults.length} cortes prontos · {formatJobPhase(job.phase)}</p>
                        </div>
                        <strong>{Math.round(job.progress)}%</strong>
                      </div>

                      <div className="export-job-progress" aria-label={`Progresso ${Math.round(job.progress)}%`}>
                        <span style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} />
                      </div>

                      {job.currentClipId && (
                        <p className="export-job-current">
                          Corte atual: {job.clipResults.find((clip) => clip.clipId === job.currentClipId)?.title || 'processando'}
                        </p>
                      )}

                      {job.error && <p className="export-job-error">{job.error}</p>}

                      {failedClips.length > 0 && (
                        <div className="export-job-failures">
                          <span>Cortes que precisam de retry:</span>
                          {failedClips.map((clip) => (
                            <button
                              className="export-job-retry-link"
                              disabled={Boolean(jobActionId)}
                              key={clip.clipId}
                              onClick={() => void handleRetry(job.id, clip.clipId)}
                              type="button"
                            >
                              <RefreshCw size={13} />
                              {clip.title}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="export-job-actions">
                        {(job.status === 'queued' || job.status === 'running') && (
                          <button
                            className="workflow-secondary"
                            disabled={isBusy || Boolean(jobActionId)}
                            onClick={() => void handleCancel(job.id)}
                            type="button"
                          >
                            {isBusy ? <LoaderCircle className="spin" size={15} /> : <XCircle size={15} />}
                            Cancelar
                          </button>
                        )}
                        {canRetry && (
                          <button
                            className="workflow-primary"
                            disabled={Boolean(jobActionId)}
                            onClick={() => void handleRetry(job.id)}
                            type="button"
                          >
                            <RefreshCw size={15} />
                            Repetir pendentes
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {!isLoading && !error && packages.length === 0 && (
          <div className="route-panel gallery-empty">
            <Folder size={34} />
            <h2>Nenhum pacote exportado</h2>
            <p>Depois de selecionar os cortes, eles serão renderizados e armazenados nesta galeria.</p>
          </div>
        )}

        {!isLoading && !error && packages.length > 0 && (
          <section className="gallery-library" aria-labelledby="gallery-library-title">
            <div className="gallery-section-heading">
              <div>
                <span className="eyebrow">Biblioteca de exportações</span>
                <h2 id="gallery-library-title">Pacotes prontos</h2>
              </div>
              <p>Todos os cortes ficam agrupados por exportação para você revisar e publicar com mais rapidez.</p>
            </div>

            <div className="gallery-grid">
              {packages.map((galleryPackage) => (
                <article className="gallery-package" key={galleryPackage.id}>
                <div className="gallery-package-header">
                  <div className="gallery-package-identity">
                    <div className="gallery-package-kicker">
                      <PackageOpen size={16} />
                      <span>Pacote exportado</span>
                    </div>
                    <h2>{formatPackageTitle(galleryPackage.title)}</h2>
                    <time className="gallery-package-date" dateTime={galleryPackage.createdAt}>
                      Exportado em {formatDate(galleryPackage.createdAt)}
                    </time>
                  </div>
                  <div className="gallery-package-count" aria-label={`${galleryPackage.clips.length} clipes exportados`}>
                    <strong>{galleryPackage.clips.length}</strong>
                    <span>clipes</span>
                  </div>
                </div>

                <div className="gallery-package-details">
                  <div className="gallery-package-details-heading">
                    <span className="eyebrow">Configuração usada</span>
                    <span className="gallery-package-path">
                      <Folder size={14} />
                      /{galleryPackage.folderName}
                    </span>
                  </div>

                  <div className="gallery-tools">
                  {galleryPackage.canvas && (
                    <span>
                      <MonitorPlay size={14} />
                      Formato {galleryPackage.canvas.width} × {galleryPackage.canvas.height}
                    </span>
                  )}
                  <span>
                    <Subtitles size={14} />
                    {formatSubtitleMode(galleryPackage.subtitleMode)}
                  </span>
                  {galleryPackage.subtitleMode !== 'none' && galleryPackage.subtitleFont && (
                    <span>{formatSubtitleFont(galleryPackage.subtitleFont)}</span>
                  )}
                  {galleryPackage.subtitleMode !== 'none' && galleryPackage.subtitlePosition && (
                    <span>{formatSubtitlePosition(galleryPackage.subtitlePosition)}</span>
                  )}
                  <span>
                    <Volume2 size={14} />
                    {galleryPackage.audioMode}
                  </span>
                  </div>
                </div>

                <div className="gallery-clip-heading">
                  <div>
                    <span className="eyebrow">Arquivos finais</span>
                    <h3>Cortes exportados</h3>
                  </div>
                  <span className="gallery-clip-count">{galleryPackage.clips.length} arquivos MP4</span>
                </div>

                <div className="gallery-clip-list">
                  {galleryPackage.clips.map((clip) => (
                    <article className="gallery-clip" key={clip.id}>
                      <div className="gallery-clip-media">
                        {clip.url ? (
                          <video src={clip.url} controls preload="metadata" />
                        ) : (
                          <div className="gallery-clip-no-preview">
                            <MonitorPlay size={20} />
                            <span>Preview indisponível</span>
                          </div>
                        )}
                      </div>
                      <div className="gallery-clip-copy">
                        <div className="gallery-clip-title-row">
                          <h3>{clip.title}</h3>
                          <span className="gallery-clip-status">{clip.status}</span>
                        </div>
                        <p className="gallery-clip-range">{clip.range}</p>
                        <span className="gallery-clip-caption">
                          <Subtitles size={13} />
                          {clip.shouldCaption ? 'Com legenda' : 'Sem legenda'}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
