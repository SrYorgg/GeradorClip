# ClipCut

Aplicação local para importar vídeos, encontrar os melhores momentos com IA, editar layout e legendas e renderizar versões para Reels, TikTok e Shorts.

## Recursos

- Importação por arquivo ou link HTTP/HTTPS, incluindo YouTube.
- Vídeos longos com cortes de duração flexível, menores ou maiores que 1 minuto.
- Identificação dos melhores momentos usando fala, ganchos, movimento e presença de rosto.
- Links do YouTube com minutagem baixam somente o intervalo indicado.
- Editor de layout, enquadramento, zoom, rotação, imagens e canvas.
- Legendas automáticas ou manuais com texto editável e destaque por palavra.
- Verificação automática de formato, seleção em lote e fila de renderização.
- Galeria local com remoção e download ZIP de todos ou parte dos cortes.

## Requisitos

- Node.js 20.19+ ou 22.12+.
- npm.
- ffmpeg no `PATH` para recortes e renderização.
- Python 3.11 para os recursos opcionais de IA.
- `yt-dlp` para importar vídeos por link.
- Ollama opcional para sugestões editoriais locais.

## Instalação

```bash
npm install
npm run setup
```

O `setup` cria o `.env` e pode solicitar o token do Hugging Face/Pyannote. Sem esse token, a aplicação continua funcionando com os recursos opcionais desativados.

Para os recursos Python:

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# Linux/macOS: source .venv/bin/activate
python -m pip install -r ai/requirements.txt
```

## Executar

Abra dois terminais na pasta do projeto:

```bash
# Terminal 1
npm run dev:api

# Terminal 2
npm run dev
```

Acesse `http://localhost:5173`. A API local fica em `http://localhost:3333`.

## Fluxo principal

1. `/arquivos` — armazene um vídeo ou importe por link.
2. `/projetos` — monte o layout e gere os cortes.
3. `/legendas` — configure e salve as legendas.
4. `/analise` — verifique os cortes; itens inválidos ficam encaminhados para ajustes futuros.
5. `/selecionar` — escolha os cortes válidos para renderizar.
6. `/galeria` — acompanhe a fila, remova itens e baixe todos ou cortes selecionados.

As sugestões editoriais ficam em `/editorial`.

## Configuração

As variáveis disponíveis estão documentadas em `.env.example`. As mais usadas são:

- `YTDLP_BIN` — caminho do executável `yt-dlp`.
- `FFMPEG_BIN` — caminho do `ffmpeg`.
- `OLLAMA_BASE_URL` e `OLLAMA_MODEL` — modelo editorial local.
- `PYANNOTE_AUTH_TOKEN` — token para diarização de locutores.

## Dados locais

- `data/` — projetos, configurações e fila de processamento.
- `public/videos/` — vídeos importados.
- `public/project-assets/` — imagens usadas nos layouts.
- `public/gallery/` — cortes renderizados.

Essas pastas são geradas localmente e não substituem um banco de dados de produção.

## Validação

```bash
npm run build
node --check server/index.cjs
node --check server/composition.cjs
```
