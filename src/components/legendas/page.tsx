import { useEffect, useState } from 'react';
import { ArrowRight, FileText, Save, Subtitles } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CaptionSettings, Project, ProjectSummary } from '../../features/editor/domain/editor.types';
import { getProject, listProjects, saveComposition } from '../../lib/videoApi';
import { subtitleFonts } from '../../lib/subtitleFonts';
import { Header } from '../main/Header';
import '../workflow/workflow.css';

const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  mode: 'automatic',
  manualText: '',
  corrections: '',
  font: 'inter',
  position: 'bottom',
  displayMode: 'block',
  language: 'pt-BR',
};

const workflowSteps = [
  ['1', 'Armazenar vídeo', '/arquivos'],
  ['2', 'Editar layout', '/projetos'],
  ['3', 'Produzir legenda', '/legendas'],
  ['4', 'Analisar cortes', '/analise'],
  ['5', 'Selecionar cortes', '/selecionar'],
  ['6', 'Cortes armazenados', '/galeria'],
] as const;

function getCaptionSettings(project: Project | null): CaptionSettings {
  return {
    ...DEFAULT_CAPTION_SETTINGS,
    ...project?.compositions.find((composition) => composition.captionSettings)?.captionSettings,
  };
}

export function CaptionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<CaptionSettings>(DEFAULT_CAPTION_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listProjects()
      .then((loadedProjects) => {
        const readyProjects = loadedProjects.filter((currentProject) => !currentProject.isLayoutDraft);
        setProjects(readyProjects);
        const requestedProjectId = searchParams.get('projectId');
        const nextProjectId =
          readyProjects.find((currentProject) => currentProject.id === requestedProjectId)?.id ||
          readyProjects[0]?.id ||
          '';
        setSelectedProjectId(nextProjectId);
        if (nextProjectId && nextProjectId !== requestedProjectId) {
          setSearchParams({ projectId: nextProjectId }, { replace: true });
        }
      })
      .catch(() => setError('Nao foi possivel carregar os projetos.'))
      .finally(() => setIsLoading(false));
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProject(null);
      return;
    }

    let isCurrent = true;
    setIsProjectLoading(true);
    setError('');
    getProject(selectedProjectId)
      .then((loadedProject) => {
        if (!isCurrent) {
          return;
        }
        setProject(loadedProject);
        setSettings(getCaptionSettings(loadedProject));
      })
      .catch(() => {
        if (isCurrent) {
          setError('Nao foi possivel carregar o projeto selecionado.');
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

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSearchParams({ projectId }, { replace: true });
    setMessage('');
  }

  async function saveSettings(continueToAnalysis = false) {
    if (!project) {
      return false;
    }

    const settingsToSave: CaptionSettings = {
      ...settings,
      manualText: settings.manualText || '',
      corrections: settings.corrections || '',
      font: settings.font || DEFAULT_CAPTION_SETTINGS.font,
      position: settings.position || DEFAULT_CAPTION_SETTINGS.position,
      displayMode: settings.displayMode || DEFAULT_CAPTION_SETTINGS.displayMode,
      language: settings.language || DEFAULT_CAPTION_SETTINGS.language,
    };

    try {
      setIsSaving(true);
      setError('');
      setMessage('');
      let latestProject = project;

      for (const composition of project.compositions) {
        const result = await saveComposition({
          ...composition,
          captionSettings: settingsToSave,
        });
        latestProject = result.project;
      }

      setProject(latestProject);
      setSettings(settingsToSave);
      setMessage('Legenda salva em todos os cortes do projeto.');

      if (continueToAnalysis) {
        navigate(`/analise?projectId=${latestProject.id}`);
      }

      return true;
    } catch {
      setError('Nao foi possivel salvar as configuracoes de legenda.');
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace workflow-workspace">
        <div className="workflow-heading">
          <div>
            <p className="eyebrow">Etapa 3 de 6</p>
            <h1>Produzir legenda</h1>
            <p>Defina como a legenda será criada e aplicada aos cortes depois do ajuste de layout.</p>
          </div>
          {project && (
            <label className="workflow-project-select">
              Projeto ativo
              <select value={selectedProjectId} onChange={(event) => selectProject(event.target.value)}>
                {projects.map((currentProject) => (
                  <option value={currentProject.id} key={currentProject.id}>
                    {currentProject.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <nav className="workflow-steps" aria-label="Etapas do fluxo de criação">
          {workflowSteps.map(([number, label, to], index) => (
            <Link className={`workflow-step ${index === 2 ? 'active' : index < 2 ? 'done' : ''}`} to={to} key={number}>
              <span className="workflow-step-number">{number}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        {isLoading && <div className="route-panel">Carregando projetos...</div>}
        {isProjectLoading && !isLoading && <div className="route-panel">Carregando projeto...</div>}
        {error && <p className="workflow-error">{error}</p>}

        {!isLoading && !error && projects.length === 0 && (
          <div className="workflow-card workflow-empty">
            <FileText size={34} />
            <h2>Nenhum projeto pronto para receber legendas</h2>
            <p>Armazene um vídeo e ajuste pelo menos um corte antes de chegar a esta etapa.</p>
            <Link className="workflow-primary" to="/arquivos">
              Ir para arquivos
              <ArrowRight size={16} />
            </Link>
          </div>
        )}

        {!isLoading && !isProjectLoading && !error && project && (
          <section className="workflow-card">
            <div className="workflow-card-header">
              <div>
                <span className="eyebrow">{project.compositions.length} cortes no projeto</span>
                <h2>Configuração das legendas</h2>
                <p>As escolhas abaixo serão copiadas para todos os cortes deste projeto.</p>
              </div>
              <Subtitles size={28} />
            </div>

            <div className="workflow-form-grid">
              <label className="workflow-field">
                Modo da legenda
                <select
                  value={settings.mode}
                  onChange={(event) => setSettings((current) => ({ ...current, mode: event.target.value as CaptionSettings['mode'] }))}
                >
                  <option value="automatic">Automática</option>
                  <option value="manual">Manual</option>
                  <option value="none">Sem legenda</option>
                </select>
                <span className="workflow-field-help">A análise posterior sinaliza texto manual vazio.</span>
              </label>

              <label className="workflow-field">
                Fonte
                <select value={settings.font || 'inter'} onChange={(event) => setSettings((current) => ({ ...current, font: event.target.value }))}>
                  {subtitleFonts.map((font) => (
                    <option value={font.id} key={font.id}>{font.label}</option>
                  ))}
                </select>
              </label>

              <label className="workflow-field">
                Posição
                <select value={settings.position || 'bottom'} onChange={(event) => setSettings((current) => ({ ...current, position: event.target.value as CaptionSettings['position'] }))}>
                  <option value="top">Superior</option>
                  <option value="middle">Centro</option>
                  <option value="bottom">Inferior</option>
                </select>
              </label>

              <label className="workflow-field">
                Estilo da legenda
                <select
                  value={settings.displayMode || 'block'}
                  onChange={(event) => setSettings((current) => ({ ...current, displayMode: event.target.value as CaptionSettings['displayMode'] }))}
                >
                  <option value="block">Em blocos</option>
                  <option value="word">Palavra a palavra</option>
                </select>
                <span className="workflow-field-help">Usa o tempo de cada palavra quando o motor de transcrição fornecer essa informação.</span>
              </label>

              <label className="workflow-field">
                Idioma da legenda
                <select
                  value={settings.language || 'pt-BR'}
                  onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value as CaptionSettings['language'] }))}
                >
                  <option value="pt-BR">Português (traduzida)</option>
                  <option value="original">Idioma original</option>
                </select>
                <span className="workflow-field-help">A tradução usa o Ollama local e mantém os tempos do áudio.</span>
              </label>

              {settings.mode === 'manual' && (
                <label className="workflow-field full">
                  Texto manual
                  <textarea value={settings.manualText || ''} onChange={(event) => setSettings((current) => ({ ...current, manualText: event.target.value }))} placeholder="Digite o texto que será distribuído ao longo de cada corte." />
                </label>
              )}

              {settings.mode !== 'none' && (
                <label className="workflow-field full">
                  Correções de transcrição
                  <textarea value={settings.corrections || ''} onChange={(event) => setSettings((current) => ({ ...current, corrections: event.target.value }))} placeholder={'Uma correção por linha. Ex.:\nGerador Clip=GeradorClip'} />
                  <span className="workflow-field-help">Use o formato palavra ou frase original = texto corrigido.</span>
                </label>
              )}
            </div>

            {message && <p className="workflow-message">{message}</p>}
            <div className="workflow-actions">
              <button className="workflow-secondary" type="button" disabled={isSaving} onClick={() => void saveSettings(false)}>
                <Save size={16} />
                Salvar legenda
              </button>
              <button className="workflow-primary" type="button" disabled={isSaving} onClick={() => void saveSettings(true)}>
                <ArrowRight size={16} />
                {isSaving ? 'Salvando...' : 'Salvar e analisar cortes'}
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
