import { Header } from '../main/Header';

export function ProjectsPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel">
          <p className="eyebrow">Projetos</p>
          <h1>Projetos</h1>
          <p>Gerencie os clips e vídeos criados no GeradorClip.</p>
        </div>
      </section>
    </main>
  );
}
