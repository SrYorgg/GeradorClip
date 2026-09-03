import { Navigate, createBrowserRouter } from 'react-router-dom';
import { SettingsPage } from './components/ajustes/page';
import { AnalysisPage } from './components/analise/page';
import { FilesPage } from './components/arquivos/page';
import { LibraryPage } from './components/biblioteca/page';
import { CompositionEditorPage } from './components/editor/composition-page';
import { FavoritesPage } from './components/favoritos/page';
import { GalleryPage } from './components/galeria/page';
import { EditorialPage } from './components/editorial/page';
import { CaptionsPage } from './components/legendas/page';
import { TrashPage } from './components/lixeira/page';
import { ProjectsPage } from './components/projetos/page';
import { SelectionPage } from './components/selecao/page';
import { InstagramStudioPage } from './components/instagram/page';
import { IndexPage } from './components/index/page';
import { VideoEditorPage } from './components/video-editor/page';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/arquivos" replace /> },
  { path: '/arquivos', element: <FilesPage /> },
  { path: '/instagram', element: <InstagramStudioPage /> },
  { path: '/producao', element: <IndexPage /> },
  { path: '/editor-video', element: <VideoEditorPage /> },
  { path: '/legendas', element: <CaptionsPage /> },
  { path: '/editor', element: <Navigate to="/projetos" replace /> },
  { path: '/projetos/:projectId/cortes/:clipId/editor', element: <CompositionEditorPage /> },
  { path: '/analise', element: <AnalysisPage /> },
  { path: '/selecionar', element: <SelectionPage /> },
  { path: '/galeria', element: <GalleryPage /> },
  { path: '/editorial', element: <EditorialPage /> },
  { path: '/favoritos', element: <FavoritesPage /> },
  { path: '/lixeira', element: <TrashPage /> },
  { path: '/projetos', element: <ProjectsPage /> },
  { path: '/biblioteca', element: <LibraryPage /> },
  { path: '/ajustes', element: <SettingsPage /> },
]);
