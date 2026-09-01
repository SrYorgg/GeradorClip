import argparse
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path


def module_available(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False


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


def run_ffmpeg_audio_extract(video_path, audio_path):
    ffmpeg_bin = find_executable("ffmpeg", "FFMPEG_BIN")
    if not ffmpeg_bin:
        return {"available": False, "message": "ffmpeg nao encontrado. Configure FFMPEG_BIN."}

    command = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(video_path),
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
        return {"available": True, "ok": False, "message": completed.stderr[-600:]}

    return {"available": True, "ok": True, "audioPath": str(audio_path)}


def run_whisperx(audio_path):
    if not module_available("whisperx"):
        return {"available": False, "message": "whisperx nao instalado."}

    try:
        import whisperx

        device = os.environ.get("WHISPERX_DEVICE", "cpu")
        model_name = os.environ.get("WHISPERX_MODEL", "small")
        model = whisperx.load_model(model_name, device, compute_type=os.environ.get("WHISPERX_COMPUTE_TYPE", "int8"))
        vad_filter = os.environ.get("WHISPER_VAD_FILTER", "true").lower() == "true"
        beam_size = int(os.environ.get("WHISPER_BEAM_SIZE", "5"))
        transcribe_options = {
            "word_timestamps": True,
            "condition_on_previous_text": False,
            "beam_size": max(1, beam_size),
            "temperature": 0.0,
            "vad_filter": vad_filter,
        }
        if vad_filter:
            transcribe_options["vad_parameters"] = {"min_silence_duration_ms": 500}
        try:
            result = model.transcribe(str(audio_path), **transcribe_options)
        except TypeError:
            try:
                result = model.transcribe(
                    str(audio_path),
                    word_timestamps=True,
                    condition_on_previous_text=False,
                )
            except TypeError:
                result = model.transcribe(str(audio_path))
        segments = result.get("segments", [])
        filtered_segments = []
        for segment in segments:
            text = str(segment.get("text", "")).strip()
            no_speech_probability = segment.get("no_speech_prob")
            average_log_probability = segment.get("avg_logprob")
            if (
                text
                and no_speech_probability is not None
                and average_log_probability is not None
                and float(no_speech_probability) >= 0.6
                and float(average_log_probability) <= -1.0
            ):
                continue
            if text:
                filtered_segments.append({**segment, "text": text})
        segments = filtered_segments
        text = " ".join(segment.get("text", "").strip() for segment in segments).strip()

        return {
            "available": True,
            "ok": True,
            "model": model_name,
            "transcriptionVersion": 3,
            "language": result.get("language"),
            "text": text,
            "segments": segments,
        }
    except Exception as error:
        return {"available": True, "ok": False, "message": str(error)}


def run_pyannote(audio_path):
    if not module_available("pyannote.audio"):
        return {"available": False, "message": "pyannote.audio nao instalado."}

    token = os.environ.get("PYANNOTE_AUTH_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    if not token:
        return {"available": True, "ok": False, "message": "Configure PYANNOTE_AUTH_TOKEN, HUGGINGFACE_TOKEN ou HF_TOKEN."}

    try:
        from pyannote.audio import Pipeline

        pipeline_name = os.environ.get("PYANNOTE_PIPELINE", "pyannote/speaker-diarization-3.1")
        pipeline = Pipeline.from_pretrained(pipeline_name, use_auth_token=token)
        diarization = pipeline(str(audio_path))
        turns = []

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            turns.append({"speaker": speaker, "start": turn.start, "end": turn.end})

        return {"available": True, "ok": True, "pipeline": pipeline_name, "turns": turns}
    except Exception as error:
        return {"available": True, "ok": False, "message": str(error)}


def run_mediapipe(video_path):
    if not module_available("mediapipe"):
        return {"available": False, "message": "mediapipe nao instalado."}

    if not module_available("cv2"):
        return {"available": True, "ok": False, "message": "opencv-python nao instalado."}

    try:
        import cv2
        import mediapipe as mp

        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frame_interval = max(int(fps), 1)
        frame_index = 0
        sampled_frames = 0
        frames_with_faces = 0
        max_faces = 0
        face_samples = []
        face_tracking = []
        previous_gray = None

        detector = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5)

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index % frame_interval == 0:
                sampled_frames += 1
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                detections = detector.process(rgb).detections or []
                face_count = len(detections)
                max_faces = max(max_faces, face_count)
                if face_count:
                    frames_with_faces += 1

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                small_gray = cv2.resize(gray, (64, 64))
                motion = 0.0
                if previous_gray is not None:
                    motion = min(1.0, float(cv2.absdiff(previous_gray, small_gray).mean()) / 48.0)
                previous_gray = small_gray

                faces = []
                for detection in detections:
                    try:
                        bounding_box = detection.location_data.relative_bounding_box
                        x = max(0.0, min(1.0, float(bounding_box.xmin)))
                        y = max(0.0, min(1.0, float(bounding_box.ymin)))
                        width = max(0.0, min(1.0 - x, float(bounding_box.width)))
                        height = max(0.0, min(1.0 - y, float(bounding_box.height)))
                        confidence = float(detection.score[0]) if detection.score else 0.0
                        faces.append({
                            "x": round(x, 5),
                            "y": round(y, 5),
                            "width": round(width, 5),
                            "height": round(height, 5),
                            "centerX": round(x + width / 2.0, 5),
                            "centerY": round(y + height / 2.0, 5),
                            "confidence": round(confidence, 5),
                        })
                    except Exception:
                        continue

                primary_face = max(
                    faces,
                    key=lambda face: (face["width"] * face["height"]) * max(face["confidence"], 0.01),
                    default=None,
                )
                time_seconds = frame_index / max(float(fps), 1.0)
                face_samples.append({
                    "timeSeconds": round(time_seconds, 3),
                    "faceCount": face_count,
                    "faces": faces,
                    "primaryFace": primary_face,
                    "motion": round(motion, 5),
                })

                if primary_face:
                    target_x = max(-100.0, min(100.0, (primary_face["centerX"] - 0.5) * 200.0))
                    target_y = max(-100.0, min(100.0, (primary_face["centerY"] - 0.5) * 200.0))
                    if face_tracking:
                        previous = face_tracking[-1]
                        target_x = previous["x"] * 0.65 + target_x * 0.35
                        target_y = previous["y"] * 0.65 + target_y * 0.35
                    face_tracking.append({
                        "timeMs": int(round(time_seconds * 1000)),
                        "x": round(target_x, 3),
                        "y": round(target_y, 3),
                        "scale": 1.0,
                    })

            frame_index += 1

        cap.release()
        detector.close()

        return {
            "available": True,
            "ok": True,
            "sampledFrames": sampled_frames,
            "framesWithFaces": frames_with_faces,
            "maxFaces": max_faces,
            "faceSamples": face_samples,
            "faceTracking": face_tracking,
        }
    except Exception as error:
        return {"available": True, "ok": False, "message": str(error)}


def run_ollama(transcript_text):
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.environ.get("OLLAMA_MODEL", "llama3.2:1b")

    prompt = (
        "Analise a transcricao abaixo e gere um resumo curto, topicos de corte e ideias de titulo em portugues.\n\n"
        f"Transcricao:\n{transcript_text[:8000] if transcript_text else 'Sem transcricao disponivel.'}"
    )

    payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = json.loads(response.read().decode("utf-8"))
            return {"available": True, "ok": True, "model": model, "response": data.get("response", "")}
    except (urllib.error.URLError, TimeoutError) as error:
        return {"available": False, "model": model, "message": str(error)}
    except Exception as error:
        return {"available": True, "ok": False, "model": model, "message": str(error)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    video_path = Path(args.video).resolve()
    output_path = Path(args.output).resolve()

    result = {
        "videoPath": str(video_path),
        "tools": {},
    }

    with tempfile.TemporaryDirectory() as temp_dir:
      audio_path = Path(temp_dir) / "audio.wav"
      result["tools"]["ffmpeg"] = run_ffmpeg_audio_extract(video_path, audio_path)

      if result["tools"]["ffmpeg"].get("ok"):
          result["tools"]["whisperx"] = run_whisperx(audio_path)
          result["tools"]["pyannote"] = run_pyannote(audio_path)
      else:
          result["tools"]["whisperx"] = {"available": False, "message": "Audio nao extraido."}
          result["tools"]["pyannote"] = {"available": False, "message": "Audio nao extraido."}

      result["tools"]["mediapipe"] = run_mediapipe(video_path)

      transcript = result["tools"].get("whisperx", {}).get("text", "")
      result["tools"]["ollama"] = run_ollama(transcript)

    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
