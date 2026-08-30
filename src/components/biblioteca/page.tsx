import { BookOpen } from 'lucide-react';
import { Header } from '../main/Header';
import { EmptyState } from '../ui';

export function LibraryPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel cc-route-page">
          <p className="eyebrow">Biblioteca</p>
          <EmptyState icon={BookOpen} title="Biblioteca" description="Acesse arquivos, templates e exports salvos." />
        </div>
      </section>
    </main>
  );
}
