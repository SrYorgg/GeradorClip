import { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Target, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Project, ProjectSummary } from '../../features/editor/domain/editor.types';
import type {
  EditorialConfig,
  EditorialDictionaryEntry,
  EditorialProviderStatus,
  EditorialScore,
} from '../../features/editorial/domain/editorial.types';
import {
  analyzeProjectEditorial,
  getEditorialConfig,
  getEditorialStatus,
  getProject,
  listProjects,
  saveCompositionEditorial,
  saveEditorialConfig,
} from '../../lib/videoApi';
import { Header } from '../main/Header';
import '../workflow/workflow.css';
import './editorial.css';

type MetadataDraft = {
  title: string;
  description: string;
};

function scoreTone(score: number) {
  if (score > 70) {
    return 'strong';
  }

  if (score === 70) {
    return 'attention';
  }

  return 'weak';
}

function scoreAccent(tone: string) {
  if (tone === 'strong') {
    return '#70d3a7';
  }

  if (tone === 'attention') {
    return '#8068d9';
  }

  return '#ff817c';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getDraft(composition: Project['compositions'][number]): MetadataDraft {
  return {
    title: composition.editorial?.title || composition.title,
    description: composition.editorial?.description || '',
  };
}

function getAverageScore(compositions: Project['compositions']) {
  const scores = compositions
    .map((composition) => composition.editorial?.score?.total)
    .filter((score): score is number => Number.isFinite(score));

  if (scores.length === 0) {
    return null;
  }

  return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}

export function EditorialPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<EditorialConfig | null>(null);
  const [providerStatus, setProviderStatus] = useState<EditorialProviderStatus | null>(null);
  const [aiDraft, setAiDraft] = useState<EditorialConfig['ai'] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MetadataDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [savingCompositionId, setSavingCompositionId] = useState('');
  const [isSavingDictionary, setIsSavingDictionary] = useState(false);
  const [isSavingAi, setIsSavingAi] = useState(false);
  const [newEntry, setNewEntry] = useState({ term: '', replacement: '', kind: 'preferred' as EditorialDictionaryEntry['kind'] });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([listProjects(), getEditorialConfig(), getEditorialStatus()])
      .then(([loadedProjects, loadedConfig, loadedStatus]) => {
        const availableProjects = loadedProjects.filter((currentProject) => !currentProject.isLayoutDraft);
        const requestedProjectId = searchParams.get('projectId');
        const nextProjectId = availableProjects.find((currentProject) => currentProject.id === requestedProjectId)?.id
          || availableProjects[0]?.id
          || '';
        setProjects(availableProjects);
        setConfig(loadedConfig);
        setAiDraft(loadedConfig.ai);
        setProviderStatus(loadedStatus);
        setSelectedProjectId(nextProjectId);
        if (nextProjectId && nextProjectId !== requestedProjectId) {
          setSearchParams({ projectId: nextProjectId }, { replace: true });
        }
      })
      .catch(() => setError('Não foi possível carregar a base editorial.'))
      .finally(() => setIsLoading(false));
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProject(null);
      return;
    }

    let isCurrent = true;
    setIsProjectLoading(true);
    getProject(selectedProjectId)
      .then((loadedProject) => {
        if (isCurrent) {
          setProject(loadedProject);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setError('Não foi possível carregar o projeto selecionado.');
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsProjectLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedProjectId]);

  useEffect(() => {
    if (!project) {
      setDrafts({});
      return;
    }

    setDrafts(Object.fromEntries(project.compositions.map((composition) => [composition.id, getDraft(composition)])));
  }, [project]);

  const scoredCount = project?.compositions.filter((composition) => Boolean(composition.editorial?.score)).length || 0;
  const averageScore = useMemo(() => getAverageScore(project?.compositions || []), [project]);
  const activeEvaluationSet = config?.evaluation.sets.find((set) => set.id === config.evaluation.activeSetId);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSearchParams({ projectId }, { replace: true });
    setMessage('');
    setError('');
  }

  async function analyzeEditorial() {
    if (!project) {
      return;
    }

    try {
      setIsAnalyzing(true);
      setMessage('');
      setError('');
      setProject(await analyzeProjectEditorial(project.id));
      setMessage('Score editorial e sugestões de metadados atualizados.');
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Não foi possível analisar o projeto.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function updateDraft(compositionId: string, field: keyof MetadataDraft, value: string) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [compositionId]: {
        ...(currentDrafts[compositionId] || { title: '', description: '' }),
        [field]: value,
      },
    }));
  }

  async function saveMetadata(compositionId: string) {
    if (!project || !drafts[compositionId]) {
      return;
    }

    try {
      setSavingCompositionId(compositionId);
      setMessage('');
      setError('');
      setProject(await saveCompositionEditorial(project.id, compositionId, drafts[compositionId]));
      setMessage('Metadados salvos como revisão manual.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar os metadados.');
    } finally {
      setSavingCompositionId('');
    }
  }

  async function saveDictionary(nextEntries: EditorialDictionaryEntry[]) {
    if (!config) {
      return;
    }

    try {
      setIsSavingDictionary(true);
      setError('');
      setConfig(await saveEditorialConfig({
        ...config,
        brand: { ...config.brand, entries: nextEntries },
      }));
      setMessage('Dicionário de marca atualizado. Execute a análise novamente para aplicar as regras aos scores.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o dicionário.');
    } finally {
      setIsSavingDictionary(false);
    }
  }

  function addDictionaryEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !newEntry.term.trim()) {
      return;
    }

    const entry: EditorialDictionaryEntry = {
      id: `editorial-entry-${Date.now()}`,
      term: newEntry.term.trim(),
      replacement: newEntry.replacement.trim(),
      kind: newEntry.kind,
    };
    void saveDictionary([...config.brand.entries, entry]);
    setNewEntry({ term: '', replacement: '', kind: 'preferred' });
  }

  function removeDictionaryEntry(entryId: string) {
    if (!config) {
      return;
    }

    void saveDictionary(config.brand.entries.filter((entry) => entry.id !== entryId));
  }

  async function refreshProviderStatus() {
    try {
      setProviderStatus(await getEditorialStatus());
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Não foi possível consultar o modelo local.');
    }
  }

  async function saveAiSettings() {
    if (!config || !aiDraft) {
      return;
    }

    try {
      setIsSavingAi(true);
      setError('');
      const savedConfig = await saveEditorialConfig({ ...config, ai: aiDraft });
      setConfig(savedConfig);
      setAiDraft(savedConfig.ai);
      setProviderStatus(await getEditorialStatus());
      setMessage('Configuração do modelo local atualizada.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o modelo local.');
    } finally {
      setIsSavingAi(false);
    }
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace editorial-page">
        <section className="editorial-hero">
          <div className="editorial-hero-mark" aria-hidden="true">
            <Sparkles size={25} />
          </div>
          <div className="editorial-hero-copy">
            <p className="eyebrow">Ciclo 3 · fundação editorial</p>
            <h1>Inteligência editorial</h1>
            <p>Transforme sinais do vídeo em decisões explicáveis antes de aprovar e exportar.</p>
          </div>
          <div className="editorial-hero-stat">
            <strong className={averageScore === null ? undefined : averageScore < 70 ? 'score-low' : averageScore > 70 ? 'score-high' : 'score-neutral'}>{averageScore === null ? '—' : averageScore}</strong>
            <span>score médio</span>
          </div>
        </section>

        {isLoading && <div className="route-panel">Carregando base editorial...</div>}
        {error && <div className="route-panel editorial-error"><CircleAlert size={18} />{error}</div>}

        {!isLoading && !error && (
          <>
            <section className="workflow-card editorial-control-card">
              <div className="workflow-card-header">
                <div>
                  <span className="eyebrow">Diagnóstico do projeto</span>
                  <h2>Score com trilha de evidências</h2>
                  <p>O primeiro modelo é determinístico e local. Ele prepara uma referência comparável antes de conectar modelos de linguagem.</p>
                </div>
                <label className="workflow-project-select">
                  Projeto ativo
                  <select value={selectedProjectId} onChange={(event) => selectProject(event.target.value)}>
                    {projects.map((currentProject) => (
                      <option value={currentProject.id} key={currentProject.id}>{currentProject.title}</option>
                    ))}
                  </select>
                </label>
              </div>

              {config?.ai && aiDraft && (
                <div className="editorial-ai-settings">
                  <div className="editorial-ai-settings-heading">
                    <div>
                      <span className="eyebrow"><Bot size={14} /> Modelo local</span>
                      <strong>{providerStatus?.ready ? 'Pronto para análise' : 'Usando fallback seguro'}</strong>
                      <p>{providerStatus?.reason || 'Configure o provedor local para gerar sugestões editoriais.'}</p>
                    </div>
                    <span className={`editorial-provider-status ${providerStatus?.ready ? 'ready' : 'offline'}`}>
                      <span aria-hidden="true" />
                      {providerStatus?.ready ? 'online' : 'offline'}
                    </span>
                  </div>
                  <div className="editorial-ai-fields">
                    <label className="editorial-ai-toggle">
                      <input
                        type="checkbox"
                        checked={aiDraft.enabled}
                        onChange={(event) => setAiDraft((current) => current ? { ...current, enabled: event.target.checked } : current)}
                      />
                      <span>Usar modelo local quando disponível</span>
                    </label>
                    <label className="workflow-field">
                      Modelo
                      <input value={aiDraft.model} onChange={(event) => setAiDraft((current) => current ? { ...current, model: event.target.value } : current)} />
                    </label>
                    <label className="workflow-field">
                      Endpoint
                      <input value={aiDraft.baseUrl} onChange={(event) => setAiDraft((current) => current ? { ...current, baseUrl: event.target.value } : current)} />
                    </label>
                    <label className="workflow-field editorial-ai-timeout">
                      Timeout (ms)
                      <input type="number" min={1000} max={120000} step={1000} value={aiDraft.timeoutMs} onChange={(event) => setAiDraft((current) => current ? { ...current, timeoutMs: Number(event.target.value) } : current)} />
                    </label>
                  </div>
                  <div className="editorial-ai-actions">
                    <button className="workflow-secondary" type="button" disabled={isSavingAi} onClick={() => void saveAiSettings()}>
                      {isSavingAi ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                      Salvar configuração
                    </button>
                    <button className="workflow-secondary" type="button" onClick={() => void refreshProviderStatus()}>
                      <RefreshCw size={15} />
                      Testar conexão
                    </button>
                  </div>
                </div>
              )}

              <div className="editorial-control-row">
                <div className="editorial-progress-copy">
                  <Target size={18} />
                  <span>{scoredCount} de {project?.compositions.length || 0} cortes avaliados</span>
                </div>
                <button className="workflow-primary editorial-analyze-button" type="button" disabled={!project || isProjectLoading || isAnalyzing} onClick={() => void analyzeEditorial()}>
                  {isAnalyzing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                  {isAnalyzing ? 'Analisando...' : 'Executar análise editorial'}
                </button>
              </div>
              {message && <p className="editorial-message"><CheckCircle2 size={16} />{message}</p>}
            </section>

            {project && project.compositions.length > 0 ? (
              <section className="editorial-compositions-section" aria-labelledby="editorial-compositions-title">
                <div className="editorial-section-heading">
                  <div>
                    <span className="eyebrow">Leitura por corte</span>
                    <h2 id="editorial-compositions-title">Composições avaliadas</h2>
                  </div>
                  <div className="editorial-section-summary">
                    <strong>{scoredCount}</strong>
                    <span>de {project.compositions.length} com score</span>
                  </div>
                </div>

                <div className="editorial-composition-list">
                {project.compositions.map((composition, index) => {
                  const score: EditorialScore | undefined = composition.editorial?.score;
                  const draft = drafts[composition.id] || getDraft(composition);
                  const tone = score ? scoreTone(score.total) : 'empty';
                  const accent = scoreAccent(tone);
                  const isLowScore = score ? score.total < 70 : false;

                  return (
                    <article className={`workflow-card editorial-composition-card ${tone} ${isLowScore ? 'low-score' : ''}`} key={composition.id}>
                      <header className="editorial-composition-header">
                        <div>
                          <span className="eyebrow">Corte {String(index + 1).padStart(2, '0')} · {composition.editorial?.status === 'reviewed' ? 'revisado' : 'rascunho'}</span>
                          <h2>{composition.title}</h2>
                          <p>Revisão {composition.revision} · atualizado em {formatDate(composition.updatedAt)}</p>
                        </div>
                        <div className="editorial-score-ring" aria-label={score ? `Score editorial ${score.total} de 100` : 'Score ainda não calculado'} style={{ background: score ? `conic-gradient(${accent} ${score.total}%, #2c3039 0)` : undefined }}>
                          <div>
                            <strong>{score ? score.total : '—'}</strong>
                            <span>/ 100</span>
                          </div>
                        </div>
                      </header>

                      {score ? (
                        <div className="editorial-dimension-grid">
                          {score.dimensions.map((dimension) => (
                            <div className={`editorial-dimension ${dimension.score < 70 ? 'score-low' : dimension.score > 70 ? 'score-high' : 'score-neutral'}`} key={dimension.id}>
                              <div className="editorial-dimension-heading">
                                <span>{dimension.label}</span>
                                <strong>{dimension.score}</strong>
                              </div>
                              <div className="editorial-meter"><span style={{ width: `${dimension.score}%` }} /></div>
                              <p>{dimension.evidence}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="editorial-empty-score">
                          <Sparkles size={17} />
                          <span>Execute a análise para gerar score, razões e metadados sugeridos.</span>
                        </div>
                      )}

                      {score && (
                        <div className="editorial-reasons">
                          <span className="editorial-reasons-heading">Por que este score?</span>
                          <ul>{score.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                        </div>
                      )}

                      <div className="editorial-metadata">
                        <div className="editorial-metadata-heading">
                          <span className="eyebrow">Metadados de publicação</span>
                          <h3>Edite antes de aprovar</h3>
                        </div>
                        <label className="workflow-field">
                          Título
                          <input value={draft.title} maxLength={100} onChange={(event) => updateDraft(composition.id, 'title', event.target.value)} />
                        </label>
                        <label className="workflow-field full">
                          Descrição
                          <textarea value={draft.description} maxLength={1000} rows={3} onChange={(event) => updateDraft(composition.id, 'description', event.target.value)} />
                        </label>
                        <div className="editorial-metadata-footer">
                          <span>{composition.editorial?.titleSource === 'manual' ? 'Título manual' : 'Título sugerido'} · {score?.model || 'aguardando score'}</span>
                          <button className="workflow-secondary" type="button" disabled={savingCompositionId === composition.id} onClick={() => void saveMetadata(composition.id)}>
                            {savingCompositionId === composition.id ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
                            Salvar metadados
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                </div>
              </section>
            ) : (
              <div className="route-panel editorial-empty-project">Crie um projeto com cortes para iniciar a análise editorial.</div>
            )}

            <section className="workflow-card editorial-lower-grid">
              <div className="editorial-dictionary-panel">
                <div className="workflow-card-header">
                  <div>
                    <span className="eyebrow">Controle de linguagem</span>
                    <h2>Dicionário de marca</h2>
                    <p>Termos preferidos ajudam sugestões; termos proibidos reduzem a aderência do corte.</p>
                  </div>
                </div>
                <form className="editorial-dictionary-form" onSubmit={addDictionaryEntry}>
                  <input aria-label="Termo" placeholder="Termo" value={newEntry.term} onChange={(event) => setNewEntry((current) => ({ ...current, term: event.target.value }))} />
                  <input aria-label="Substituição" placeholder="Substituição opcional" value={newEntry.replacement} onChange={(event) => setNewEntry((current) => ({ ...current, replacement: event.target.value }))} />
                  <select aria-label="Tipo" value={newEntry.kind} onChange={(event) => setNewEntry((current) => ({ ...current, kind: event.target.value as EditorialDictionaryEntry['kind'] }))}>
                    <option value="preferred">Preferido</option>
                    <option value="forbidden">Proibido</option>
                  </select>
                  <button className="workflow-primary" type="submit" disabled={isSavingDictionary}><Plus size={15} />Adicionar</button>
                </form>
                <div className="editorial-dictionary-list">
                  {config?.brand.entries.length ? config.brand.entries.map((entry) => (
                    <div className={`editorial-dictionary-item ${entry.kind}`} key={entry.id}>
                      <span>{entry.term}</span>
                      <small>{entry.kind === 'preferred' ? `→ ${entry.replacement || 'manter'}` : 'evitar'}</small>
                      <button type="button" aria-label={`Remover ${entry.term}`} disabled={isSavingDictionary} onClick={() => removeDictionaryEntry(entry.id)}><Trash2 size={14} /></button>
                    </div>
                  )) : <p className="editorial-muted">Nenhuma regra cadastrada ainda.</p>}
                </div>
              </div>

              <div className="editorial-evaluation-panel">
                <div className="workflow-card-header">
                  <div>
                    <span className="eyebrow">Guardrail</span>
                    <h2>Avaliação versionada</h2>
                    <p>Todo score aponta para um conjunto identificável, pronto para comparação quando o modelo mudar.</p>
                  </div>
                </div>
                <div className="editorial-evaluation-callout">
                  <strong>{activeEvaluationSet?.name || 'Baseline heurístico'}</strong>
                  <span>id: {activeEvaluationSet?.id || 'editorial-baseline-v1'}</span>
                  <small>{activeEvaluationSet?.cases.length || 0} casos · versão {activeEvaluationSet?.version || '1.0.0'}</small>
                </div>
                <div className="editorial-gradual-list">
                  <span><CheckCircle2 size={15} />Heurística local ativa</span>
                  <span><CircleAlert size={15} />Embeddings, diarização e visão entram por adaptadores</span>
                  <span><CircleAlert size={15} />Nenhuma sugestão aprova ou exporta sozinha</span>
                </div>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
