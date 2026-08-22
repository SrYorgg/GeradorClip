# GeradorClip

GeradorClip e uma aplicacao local para enviar videos, gerar sugestoes de cortes, selecionar quais cortes serao legendados e exportar pacotes de clipes para uma galeria.

## O que a aplicacao faz

- Envia videos para armazenamento local em `public/videos`.
- Lista os videos enviados na pagina `/arquivos`.
- Mostra miniaturas e player dos videos salvos.
- Executa uma analise local opcional com `ffmpeg`, WhisperX, MediaPipe, Pyannote e Ollama.
- Na pagina principal, seleciona um video ja salvo em `/arquivos`.
- Gera cortes sugeridos a partir do video selecionado.
- Permite escolher quais cortes entram no pacote final.
- Permite marcar quais cortes devem receber legenda.
- Exporta os cortes para pastas dentro de `public/gallery`.
- Lista os pacotes exportados na pagina `/galeria`.

## Stack

- React
- TypeScript
- Vite
- React Router
- lucide-react
- Express
- Multer
- Python para ferramentas de IA locais

## Requisitos

- Node.js
- npm
- Python 3.11 recomendado
- ffmpeg instalado localmente
- Ollama instalado localmente, se quiser usar LLM local

Ferramentas opcionais de IA:

- WhisperX para transcricao
- MediaPipe/OpenCV para analise visual simples
- Pyannote para diarizacao de locutor
- Ollama para resumo e ideias de cortes com LLM local

## Como rodar apos clonar

Instale as dependencias do Node:

```bash
npm install
```

Crie o ambiente Python:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r ai\requirements.txt
```

Baixe um modelo no Ollama:

```bash
ollama pull llama3.2:1b
```

Inicie a API local:

```bash
npm run dev:api
```

Em outro terminal, inicie o frontend:

```bash
npm run dev
```

Acesse:

```txt
http://localhost:5173
```

## Variaveis de ambiente

Existe um arquivo `.env.example` com os nomes das variaveis usadas. Ele nao contem segredos reais.

Principais variaveis:

```env
API_PORT=3333
PYTHON_BIN=.venv\Scripts\python.exe
FFMPEG_BIN=
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:1b
WHISPERX_MODEL=small
WHISPERX_DEVICE=cpu
WHISPERX_COMPUTE_TYPE=int8
PYANNOTE_AUTH_TOKEN=
HUGGINGFACE_TOKEN=
```

No PowerShell, voce pode definir uma variavel temporaria assim:

```powershell
$env:PYANNOTE_AUTH_TOKEN="hf_seu_token"
```

Para salvar no Windows:

```powershell
setx PYANNOTE_AUTH_TOKEN "hf_seu_token"
```

Depois de usar `setx`, feche e abra o terminal novamente.

## Token do Pyannote

O Pyannote precisa de um token do Hugging Face para acessar alguns modelos.

Passos:

1. Crie ou entre na conta do Hugging Face.
2. Aceite os termos dos modelos `pyannote/segmentation-3.0` e `pyannote/speaker-diarization-3.1`.
3. Crie um token em `Settings > Access Tokens`.
4. Use permissao de leitura.
5. Defina `PYANNOTE_AUTH_TOKEN` ou `HUGGINGFACE_TOKEN` no ambiente local.

Nunca coloque esse token no codigo, no README ou em arquivos versionados.

## Publicacao no GitHub

Antes de publicar, confira:

- Nao subir `.env`.
- Nao subir tokens reais.
- Nao subir videos pessoais de `public/videos`.
- Nao subir clipes exportados de `public/gallery`.
- Nao subir `.venv`, `.cache`, `node_modules` ou `dist`.

O `.gitignore` ja ignora esses itens e mantem apenas `.gitkeep` nas pastas de videos e galeria.

Se algum token real ja tiver sido commitado em algum momento, revogue o token no servico de origem e gere outro. Apagar o arquivo depois nao remove o segredo do historico do Git.

## Scripts

```bash
npm run dev
```

Inicia o frontend Vite.

```bash
npm run dev:api
```

Inicia a API Express local.

```bash
npm run build
```

Valida TypeScript e gera o build de producao.

```bash
npm run preview
```

Serve o build localmente para preview.

## Estrutura principal

```txt
ai/                 Scripts Python e requirements de IA
server/             API local Express
src/                Frontend React/TypeScript
public/videos/      Videos enviados localmente
public/gallery/     Pacotes exportados localmente
```

## Observacoes

- Os arquivos exportados sao gerados localmente.
- O backend usa `ffmpeg` para recortar os clipes no momento da exportacao.
- O primeiro uso do WhisperX pode baixar modelos e demorar.
- Sem token do Pyannote, a aplicacao ainda funciona, mas a diarizacao fica pendente.
- Sem Ollama rodando, a parte de resumo/ideias por LLM local fica indisponivel.
