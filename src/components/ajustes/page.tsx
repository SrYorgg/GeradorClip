import { useState } from 'react';
import { KeyRound, Settings, ShieldCheck } from 'lucide-react';
import { Header } from '../main/Header';
import { EmptyState } from '../ui';
import './page.css';

export function SettingsPage() {
  const [isOpeningSetup, setIsOpeningSetup] = useState(false);
  const [message, setMessage] = useState('');

  async function openSetup() {
    if (!window.clipcutDesktop?.openSetup) {
      setMessage('A configuração inicial está disponível no aplicativo desktop.');
      return;
    }

    setIsOpeningSetup(true);
    setMessage('');
    try {
      await window.clipcutDesktop.openSetup();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível abrir a configuração.');
      setIsOpeningSetup(false);
    }
  }

  return (
    <main className="app-shell">
      <Header />
      <section className="workspace">
        <div className="settings-content">
          <div className="settings-heading">
            <p className="eyebrow">Ajustes do ClipCut</p>
            <h1>Ambiente e preferências</h1>
            <p>Gerencie a configuração local do aplicativo sem sair do fluxo de edição.</p>
          </div>

          <div className="settings-grid">
            <section className="settings-card settings-card-primary">
              <div className="settings-card-icon"><KeyRound size={22} /></div>
              <div>
                <p className="eyebrow">Configuração inicial</p>
                <h2>Token e pasta de trabalho</h2>
                <p>Reabra a tela de configuração para atualizar o token do Pyannote ou trocar a pasta onde os dados do ClipCut ficam salvos.</p>
                <button className="settings-action" type="button" onClick={openSetup} disabled={isOpeningSetup}>
                  <KeyRound size={17} />
                  {isOpeningSetup ? 'Abrindo configuração...' : 'Reabrir configuração do desktop'}
                </button>
                {message && <p className="settings-message" role="status">{message}</p>}
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-icon"><ShieldCheck size={22} /></div>
              <div>
                <p className="eyebrow">Segurança</p>
                <h2>Credenciais protegidas</h2>
                <p>O token é armazenado de forma segura pelo aplicativo desktop e não fica exposto na interface do projeto.</p>
              </div>
            </section>
          </div>

          <div className="settings-legacy-state">
            <EmptyState icon={Settings} title="Mais ajustes em breve" description="Formatos, presets e preferências avançadas serão adicionados aqui." />
          </div>
        </div>
      </section>
    </main>
  );
}
