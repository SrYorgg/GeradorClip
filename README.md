# GeradorClip

GeradorClip é uma aplicação local para enviar vídeos, gerar sugestões de cortes, revisar o enquadramento, adicionar legendas e exportar pacotes de clipes.

## Funcionalidades

- Upload e armazenamento local de vídeos em public/videos.
- Lista de vídeos enviados em /arquivos.
- Geração de cortes sugeridos por duração ou quantidade.
- Análise opcional com ffmpeg, WhisperX, MediaPipe, Pyannote e Ollama.
- Seleção dos cortes que entrarão no pacote final.
- Legendas automáticas ou manuais.
- Exportação de clipes para public/gallery.
- Galeria local em /galeria.

### Editor de composição — Ciclo 1

O editor fica disponível em /projetos e permite revisar cada corte antes da exportação:

- Timeline com playhead, preview e seleção de segmentos.
- Ajuste do início e fim de cada trecho.
- Divisão no playhead, duplicação, exclusão e reordenação.
- Histórico de desfazer/refazer.
- Autosave com controle de revisão no backend.
- Aprovação da composição sem gerar o MP4 imediatamente.
- Formatos prontos 9:16, 4:5, 1:1, 16:9 e 4:3.
- Dimensões customizadas do canvas.
- Ajuste da área do vídeo dentro do canvas: posição, largura e altura.
- Reenquadramento por corte: posição X/Y, zoom, rotação e modo de preenchimento.
- Reposicionamento direto arrastando o vídeo no preview.
- Cor de fundo e visualização da área segura.
- Atalhos Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z e Ctrl/Cmd + S.

> O Ciclo 1 salva a composição editável. O render final do MP4 usando todos os ajustes de layout será conectado à etapa de exportação posterior.

## Requisitos

- Node.js 20.19+ ou 22.12+.
- npm.
- Python 3.11 recomendado para as ferramentas de IA.
- ffmpeg instalado e disponível no PATH para recortes e exportação.
- Ollama instalado localmente, caso queira usar resumo e sugestões com LLM.

WhisperX, MediaPipe/OpenCV, Pyannote e Ollama são opcionais. A aplicação principal e o editor podem ser usados sem eles.

## Instalação passo a passo

### 1. Baixe o projeto

~~~
git clone <URL_DO_REPOSITORIO>
cd GeradorClip
~~~

Se você recebeu a pasta do projeto por outro meio, apenas abra o terminal dentro de GeradorClip.

### 2. Instale as dependências do Node

~~~
npm install
~~~

### 3. Prepare o ambiente Python

Windows PowerShell:

~~~
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r ai\requirements.txt
~~~

Linux/macOS:

~~~
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r ai/requirements.txt
~~~

Se o PowerShell bloquear a ativação, execute no terminal:

~~~
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
~~~

### 4. Instale as ferramentas opcionais

Para exportar usando recorte real, instale o ffmpeg e confirme:

~~~
ffmpeg -version
~~~

Para usar o Ollama, instale-o e baixe um modelo:

~~~
ollama pull llama3.2:1b
~~~

### 5. Crie o .env automaticamente

Não é necessário copiar o .env.example manualmente.

Na primeira execução de qualquer um dos comandos abaixo, o GeradorClip verifica se o .env existe:

~~~
npm run dev
~~~

ou:

~~~
npm run dev:api
~~~

Se o arquivo ainda não existir, o terminal solicitará o token Hugging Face/Pyannote. Cole o token e pressione Enter. Para continuar sem diarização, pressione apenas Enter.

O arquivo .env será criado automaticamente com os valores padrão e o token informado em PYANNOTE_AUTH_TOKEN. Ele é ignorado pelo Git e nunca é exibido pela aplicação.

Também é possível executar somente essa etapa:

~~~
npm run setup
~~~

Se o .env já existir, nenhum token será solicitado novamente. Para alterar a configuração, edite o .env local ou execute o setup depois de removê-lo.

### 6. Inicie a aplicação

Abra dois terminais na pasta do projeto.

Terminal 1 — API:

~~~
npm run dev:api
~~~

Terminal 2 — frontend:

~~~
npm run dev
~~~

Acesse:

~~~
http://localhost:5173
~~~

O backend fica em http://localhost:3333.

## Configuração e tokens

O arquivo .env.example documenta todas as variáveis disponíveis:

~~~
API_PORT=3333
PYTHON_BIN=.venv\Scripts\python.exe
FFMPEG_BIN=
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:1b
WHISPERX_MODEL=small
FASTER_WHISPER_MODEL=small
WHISPERX_DEVICE=cpu
WHISPERX_COMPUTE_TYPE=int8
WHISPER_VAD_FILTER=false
PYANNOTE_AUTH_TOKEN=
HUGGINGFACE_TOKEN=
HF_TOKEN=
~~~

O único segredo usado atualmente é o token do Hugging Face para o Pyannote. O backend aceita PYANNOTE_AUTH_TOKEN, HUGGINGFACE_TOKEN ou HF_TOKEN; o assistente de primeiro uso salva o valor no primeiro campo.

Para obter o token:

1. Crie ou acesse uma conta no Hugging Face.
2. Aceite os termos dos modelos pyannote/segmentation-3.0 e pyannote/speaker-diarization-3.1.
3. Crie um token de acesso com permissão de leitura em Settings > Access Tokens.
4. Cole o token quando o npm run dev solicitar.

Sem o token, a aplicação continua funcionando, mas a diarização de locutores fica indisponível. Sem Ollama, apenas o resumo e as sugestões baseadas em LLM local ficam indisponíveis.

## Como usar

1. Acesse Arquivos e envie um vídeo.
2. Em Legendas, selecione o vídeo e gere os cortes sugeridos.
3. Abra um corte em Editar ou entre em Projetos.
4. No editor, escolha a proporção desejada no inspector.
5. Ajuste a área do vídeo e use o arraste no preview para posicionar a pessoa.
6. Ajuste zoom, rotação, preenchimento e intervalo do trecho.
7. Aguarde o autosave ou use Salvar rascunho.
8. Atualize a página para confirmar a persistência.
9. Clique em Aprovar corte quando o enquadramento estiver pronto.

## Testes e validação

Validação de TypeScript e build de produção:

~~~
npm run build
~~~

Checagem de sintaxe do backend:

~~~
node --check server/index.cjs
node --check server/composition.cjs
node --check scripts/setup-env.cjs
~~~

Verificação rápida da API:

~~~
Invoke-RestMethod http://localhost:3333/api/health
Invoke-RestMethod http://localhost:3333/api/projects
~~~

O primeiro endpoint deve retornar { "ok": true }.

## Scripts

~~~
npm run setup
~~~

Cria o .env na primeira execução e solicita o token disponível.

~~~
npm run dev
~~~

Cria o .env se necessário e inicia o frontend Vite.

~~~
npm run dev:api
~~~

Cria o .env se necessário e inicia a API Express local.

~~~
npm run build
~~~

Valida TypeScript e gera o build de produção.

~~~
npm run preview
~~~

Serve o build local para conferência.

## Estrutura principal

~~~text
ai/                 Scripts Python e requirements de IA
data/projects/      Composições e projetos salvos pelo editor
scripts/            Setup automático do ambiente
server/             API local Express
src/                Frontend React/TypeScript
public/videos/      Vídeos enviados localmente
public/gallery/     Pacotes exportados localmente
~~~

## Solução de problemas

### O terminal não solicita o token

O .env já existe. Edite o arquivo local ou execute o setup novamente depois de removê-lo.

### A porta 3333 já está em uso

Encerre o processo que está usando a porta ou altere API_PORT no .env e o proxy correspondente em vite.config.ts.

### A IA aparece como indisponível

Confirme o ambiente em /api/ai/status. Verifique Python, as dependências de ai/requirements.txt, ffmpeg, Ollama e o token do Hugging Face.

### O editor funciona, mas não há MP4 na galeria

A aprovação do Ciclo 1 salva a composição editável. A geração final usando o novo layout será feita na etapa de exportação.

## Segurança antes de publicar

- Nunca versione .env ou tokens reais.
- Não versione vídeos pessoais de public/videos.
- Não versione clipes exportados de public/gallery.
- Não versione .venv, .cache, node_modules ou dist.
- Se um token já tiver sido publicado, revogue-o no serviço de origem e gere outro.
