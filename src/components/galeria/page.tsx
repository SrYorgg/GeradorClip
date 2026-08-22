import { useEffect, useState } from 'react';
import { Folder, Subtitles, Volume2 } from 'lucide-react';
import { GalleryPackage, listGalleryPackages } from '../../lib/videoApi';
import { Header } from '../main/Header';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function GalleryPage() {
  const [packages, setPackages] = useState<GalleryPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listGalleryPackages()
      .then(setPackages)
      .catch(() => setError('Nao foi possivel carregar os pacotes da galeria.'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="gallery-heading">
          <div>
            <p className="eyebrow">Galeria</p>
            <h1>Galeria</h1>
          </div>
          <span>{packages.length} pacotes exportados</span>
        </div>

        {isLoading && <div className="route-panel">Carregando galeria...</div>}
        {error && <div className="route-panel">{error}</div>}

        {!isLoading && !error && packages.length === 0 && (
          <div className="route-panel gallery-empty">
            <Folder size={34} />
            <h2>Nenhum pacote exportado</h2>
            <p>Gere clipes na pagina principal e use Exportar para enviar o pacote para ca.</p>
          </div>
        )}

        {!isLoading && !error && packages.length > 0 && (
          <div className="gallery-grid">
            {packages.map((galleryPackage) => (
              <article className="gallery-package" key={galleryPackage.id}>
                <div className="gallery-package-header">
                  <div>
                    <p className="eyebrow">Pasta /{galleryPackage.folderName}</p>
                    <h2>{galleryPackage.title}</h2>
                    <span>{formatDate(galleryPackage.createdAt)}</span>
                  </div>
                  <strong>{galleryPackage.clips.length} clipes</strong>
                </div>

                <div className="gallery-tools">
                  <span>
                    <Subtitles size={14} />
                    {galleryPackage.subtitleMode}
                  </span>
                  <span>
                    <Volume2 size={14} />
                    {galleryPackage.audioMode}
                  </span>
                </div>

                <div className="gallery-clip-list">
                  {galleryPackage.clips.map((clip) => (
                    <article className="gallery-clip" key={clip.id}>
                      {clip.url && <video src={clip.url} controls preload="metadata" />}
                      <div>
                        <h3>{clip.title}</h3>
                        <p>{clip.range}</p>
                        <span>{clip.shouldCaption ? 'Com legenda' : 'Sem legenda'}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
