import { Header } from '../main/Header';

export function FavoritesPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel">
          <p className="eyebrow">Favoritos</p>
          <h1>Favoritos</h1>
          <p>Encontre rapidamente os clips marcados para reutilização.</p>
        </div>
      </section>
    </main>
  );
}
