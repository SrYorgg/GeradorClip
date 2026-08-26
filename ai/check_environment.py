import importlib.util
import json
import os
import shutil
import urllib.error
import urllib.request
from pathlib import Path


def module_available(name):
    return importlib.util.find_spec(name) is not None


def find_executable(name, env_var):
    configured_path = os.environ.get(env_var)
    if configured_path and Path(configured_path).exists():
        return configured_path

    path_result = shutil.which(name)
    if path_result:
        return path_result

    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        return None

    local_app_data_path = Path(local_app_data)
    candidates = [
        local_app_data_path / "Programs" / "Ollama" / f"{name}.exe",
        local_app_data_path / "Microsoft" / "WinGet" / "Links" / f"{name}.exe",
    ]

    winget_packages = local_app_data_path / "Microsoft" / "WinGet" / "Packages"
    if winget_packages.exists():
        candidates.extend(winget_packages.glob(f"**/{name}.exe"))

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return None


def ollama_available():
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    try:
        with urllib.request.urlopen(f"{base_url}/api/tags", timeout=2) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


status = {
    "ffmpeg": find_executable("ffmpeg", "FFMPEG_BIN") is not None,
    "whisperx": module_available("whisperx"),
    "mediapipe": module_available("mediapipe"),
    "pyannote": module_available("pyannote.audio"),
    "pyannoteToken": bool(
        os.environ.get("PYANNOTE_AUTH_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    ),
    "ollama": ollama_available(),
}

print(json.dumps(status))
