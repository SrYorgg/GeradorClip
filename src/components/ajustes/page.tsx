import { Settings } from 'lucide-react';
import { Header } from '../main/Header';
import { EmptyState } from '../ui';

export function SettingsPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel cc-route-page">
          <p className="eyebrow">Ajustes</p>
          <EmptyState icon={Settings} title="Ajustes" description="Configure formatos, presets e preferencias do projeto." />
        </div>
      </section>
    </main>
  );
}
