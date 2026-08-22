# GeradorClip AI Setup

The local API can orchestrate these optional tools:

- `ffmpeg` on PATH.
- Python packages from `ai/requirements.txt`.
- Ollama running locally at `http://localhost:11434`.
- A local Ollama model, for example `OLLAMA_MODEL=llama3.2:1b`.
- Pyannote token through `PYANNOTE_AUTH_TOKEN` or `HUGGINGFACE_TOKEN`.

Install Python dependencies:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r ai\requirements.txt
```

Run local services:

```bash
npm run dev:api
npm run dev
```

Optional environment variables:

```bash
set PYTHON_BIN=.venv\Scripts\python.exe
set FFMPEG_BIN=C:\Users\your-user\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe
set OLLAMA_BASE_URL=http://localhost:11434
set OLLAMA_MODEL=llama3.2:1b
set WHISPERX_MODEL=small
set WHISPERX_DEVICE=cpu
set WHISPERX_COMPUTE_TYPE=int8
set PYANNOTE_AUTH_TOKEN=your_token
```
