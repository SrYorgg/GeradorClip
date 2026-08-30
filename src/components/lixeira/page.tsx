import { Trash2 } from 'lucide-react';
import { Header } from '../main/Header';
import { EmptyState } from '../ui';

export function TrashPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel cc-route-page">
          <p className="eyebrow">Lixeira</p>
          <EmptyState icon={Trash2} title="Lixeira" description="Revise itens removidos antes da exclusao definitiva." />
        </div>
      </section>
    </main>
  );
}
