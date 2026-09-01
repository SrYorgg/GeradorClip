export {};

declare global {
  interface Window {
    clipcutDesktop?: {
      installAi: () => Promise<unknown>;
      installOllama: () => Promise<string>;
      openSetup: () => Promise<{ ok: boolean }>;
      onAiInstallProgress: (listener: (progress: { phase: string; percent: number; message: string }) => void) => () => void;
    };
  }
}
