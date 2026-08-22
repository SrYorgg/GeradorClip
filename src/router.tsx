import { createBrowserRouter } from 'react-router-dom';
import { SettingsPage } from './components/ajustes/page';
import { FilesPage } from './components/arquivos/page';
import { LibraryPage } from './components/biblioteca/page';
import { FavoritesPage } from './components/favoritos/page';
import { GalleryPage } from './components/galeria/page';
import { IndexPage } from './components/index/page';
import { TrashPage } from './components/lixeira/page';
import { ProjectsPage } from './components/projetos/page';

export const router = createBrowserRouter([
  { path: '/', element: <IndexPage /> },
  { path: '/galeria', element: <GalleryPage /> },
  { path: '/arquivos', element: <FilesPage /> },
  { path: '/favoritos', element: <FavoritesPage /> },
  { path: '/lixeira', element: <TrashPage /> },
  { path: '/projetos', element: <ProjectsPage /> },
  { path: '/biblioteca', element: <LibraryPage /> },
  { path: '/ajustes', element: <SettingsPage /> },
]);
