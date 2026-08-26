import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def remove_disabled_proxy_env():
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        value = os.environ.get(key, "")
        if "127.0.0.1:9" in value or "localhost:9" in value:
            os.environ.pop(key, None)


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


def extract_audio(video_path, audio_path, start, duration):
    ffmpeg_bin = find_executable("ffmpeg", "FFMPEG_BIN")
    if not ffmpeg_bin:
        return {"ok": False, "message": "ffmpeg nao encontrado. Configure FFMPEG_BIN."}

    command = [
        ffmpeg_bin,
        "-y",
        "-ss",
        str(max(start, 0)),
        "-i",
        str(video_path),
        "-t",
        str(max(duration, 1)),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(audio_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True)

    if completed.returncode != 0:
        return {"ok": False, "message": completed.stderr[-600:]}

    return {"ok": True}


def transcribe_with_faster_whisper(audio_path):
    try:
        from faster_whisper import WhisperModel

        model_name = os.environ.get("FASTER_WHISPER_MODEL") or os.environ.get("WHISPERX_MODEL", "small")
        device = os.environ.get("WHISPERX_DEVICE", "cpu")
        compute_type = os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")
        vad_filter = os.environ.get("WHISPER_VAD_FILTER", "false").lower() == "true"
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        segments, info = model.transcribe(str(audio_path), vad_filter=vad_filter)

        normalized_segments = [
            {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
            for segment in segments
            if segment.text and segment.text.strip()
        ]

        return {
            "ok": True,
            "engine": "faster-whisper",
            "model": model_name,
            "language": getattr(info, "language", None),
            "text": " ".join(segment["text"] for segment in normalized_segments).strip(),
            "segments": normalized_segments,
        }
    except Exception as error:
        return {"ok": False, "engine": "faster-whisper", "message": str(error)}


def main():
    remove_disabled_proxy_env()

    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--duration", type=float, required=True)
    args = parser.parse_args()

    video_path = Path(args.video).resolve()

    with tempfile.TemporaryDirectory() as temp_dir:
        audio_path = Path(temp_dir) / "clip.wav"
        audio_result = extract_audio(video_path, audio_path, args.start, args.duration)

        if not audio_result.get("ok"):
            print(json.dumps({"ok": False, **audio_result}, ensure_ascii=False))
            return

        result = transcribe_with_faster_whisper(audio_path)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
