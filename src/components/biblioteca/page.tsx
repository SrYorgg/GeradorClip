import { Header } from '../main/Header';

export function LibraryPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel">
          <p className="eyebrow">Biblioteca</p>
          <h1>Biblioteca</h1>
          <p>Acesse arquivos, templates e exports salvos.</p>
        </div>
      </section>
    </main>
  );
}
