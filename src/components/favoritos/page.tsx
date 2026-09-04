import { Star } from 'lucide-react';
import { Header } from '../main/Header';
import { EmptyState } from '../ui';

export function FavoritesPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel cc-route-page">
          <p className="eyebrow">Favoritos</p>
          <EmptyState icon={Star} title="Favoritos" description="Encontre rapidamente os cortes marcados para reutilização." />
        </div>
      </section>
    </main>
  );
}
