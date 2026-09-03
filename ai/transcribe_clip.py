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


def load_faster_whisper_model():
    from faster_whisper import WhisperModel

    model_name = os.environ.get("FASTER_WHISPER_MODEL") or os.environ.get("WHISPERX_MODEL", "small")
    device = os.environ.get("WHISPERX_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")
    beam_size = int(os.environ.get("WHISPER_BEAM_SIZE", "5"))
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    transcribe_options = {
        "vad_filter": os.environ.get("WHISPER_VAD_FILTER", "true").lower() == "true",
        "word_timestamps": True,
        "beam_size": max(1, beam_size),
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "compression_ratio_threshold": 2.4,
        "log_prob_threshold": -1.0,
        "no_speech_threshold": 0.6,
    }
    if transcribe_options["vad_filter"]:
        transcribe_options["vad_parameters"] = {"min_silence_duration_ms": 500}
    return model, model_name, transcribe_options


def transcribe_with_faster_whisper(audio_path, model, model_name, transcribe_options, offset_seconds=0):
    try:
        segments, info = model.transcribe(str(audio_path), **transcribe_options)

        normalized_segments = []
        for segment in segments:
            if not segment.text or not segment.text.strip():
                continue

            no_speech_probability = getattr(segment, "no_speech_prob", None)
            average_log_probability = getattr(segment, "avg_logprob", None)
            if (
                no_speech_probability is not None
                and average_log_probability is not None
                and no_speech_probability >= 0.6
                and average_log_probability <= -1.0
            ):
                continue

            words = [
                {
                    "start": word.start + offset_seconds,
                    "end": word.end + offset_seconds,
                    "word": word.word.strip(),
                    "probability": getattr(word, "probability", None),
                }
                for word in (segment.words or [])
                if word.word and word.word.strip() and word.end > word.start
            ]
            normalized_segment = {
                "start": segment.start + offset_seconds,
                "end": segment.end + offset_seconds,
                "text": segment.text.strip(),
            }
            if words:
                normalized_segment["words"] = words
            normalized_segments.append(normalized_segment)

        return {
            "ok": True,
            "engine": "faster-whisper",
            "transcriptionVersion": 3,
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
    parser.add_argument("--chunk-duration", type=float, default=300)
    args = parser.parse_args()

    video_path = Path(args.video).resolve()

    if args.duration <= 0:
        print(json.dumps({"ok": False, "message": "A duracao precisa ser positiva."}, ensure_ascii=False))
        return

    try:
        model, model_name, transcribe_options = load_faster_whisper_model()
    except Exception as error:
        print(json.dumps({"ok": False, "engine": "faster-whisper", "message": str(error)}, ensure_ascii=False))
        return

    chunk_duration = max(30.0, float(args.chunk_duration or 300))
    all_segments = []
    detected_language = None
    first_error = None

    with tempfile.TemporaryDirectory() as temp_dir:
        chunk_index = 0
        offset = 0.0
        while offset < args.duration:
            current_duration = min(chunk_duration, args.duration - offset)
            audio_path = Path(temp_dir) / f"chunk-{chunk_index}.wav"
            audio_result = extract_audio(video_path, audio_path, args.start + offset, current_duration)
            if not audio_result.get("ok"):
                first_error = audio_result.get("message") or "Falha ao extrair o audio."
                break

            result = transcribe_with_faster_whisper(
                audio_path,
                model,
                model_name,
                transcribe_options,
                offset_seconds=args.start + offset,
            )
            if not result.get("ok"):
                first_error = result.get("message") or "Falha ao transcrever o audio."
                break

            detected_language = detected_language or result.get("language")
            all_segments.extend(result.get("segments") or [])
            offset += current_duration
            chunk_index += 1

    if first_error:
        print(json.dumps({"ok": False, "engine": "faster-whisper", "message": first_error}, ensure_ascii=False))
        return

    print(json.dumps({
        "ok": True,
        "engine": "faster-whisper",
        "transcriptionVersion": 3,
        "model": model_name,
        "language": detected_language,
        "text": " ".join(segment["text"] for segment in all_segments).strip(),
        "segments": all_segments,
        "chunkDuration": chunk_duration,
        "chunks": chunk_index,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
