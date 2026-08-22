import { Header } from '../main/Header';

export function SettingsPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel">
          <p className="eyebrow">Ajustes</p>
          <h1>Ajustes</h1>
          <p>Configure formatos, presets e preferências do projeto.</p>
        </div>
      </section>
    </main>
  );
}
