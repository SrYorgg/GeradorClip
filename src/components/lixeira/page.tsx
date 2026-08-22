import { Header } from '../main/Header';

export function TrashPage() {
  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="route-panel">
          <p className="eyebrow">Lixeira</p>
          <h1>Lixeira</h1>
          <p>Revise itens removidos antes da exclusão definitiva.</p>
        </div>
      </section>
    </main>
  );
}
