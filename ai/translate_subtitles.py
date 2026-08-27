import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path


SENSITIVE_TERM_TRANSLATIONS = {
    "shit": "merda",
    "fuck": "foda-se",
    "fucking": "fodido",
    "bitch": "vadia",
    "asshole": "babaca",
    "damn": "droga",
    "hell": "inferno",
    "crap": "merda",
    "dick": "pau",
    "pussy": "buceta",
    "bastard": "bastardo",
    "merda": "merda",
    "porra": "porra",
    "caralho": "caralho",
    "puta": "puta",
}


def protect_sensitive_terms(text):
    protected = {}

    def replace(match):
        original = match.group(0)
        translation = SENSITIVE_TERM_TRANSLATIONS.get(original.lower(), original)
        marker = f"___QZ{chr(65 + len(protected))}ZX___"
        protected[marker] = translation
        return marker

    pattern = r"\b(?:" + "|".join(map(re.escape, SENSITIVE_TERM_TRANSLATIONS)) + r")\b"
    return re.sub(pattern, replace, text, flags=re.IGNORECASE), protected


def restore_sensitive_terms(text, protected):
    restored = text
    for marker, translation in protected.items():
        restored = re.sub(re.escape(marker), translation, restored, flags=re.IGNORECASE)
        marker_match = re.search(r"QZ([A-Z])ZX", marker, flags=re.IGNORECASE)
        if marker_match:
            code = marker_match.group(1)
            restored = re.sub(
                rf"_+QZ{re.escape(code)}ZX_+",
                translation,
                restored,
                flags=re.IGNORECASE,
            )
    return restored


def call_ollama(base_url, payload):
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/generate",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=180) as response:
        data = json.loads(response.read().decode("utf-8"))

    raw_response = str(data.get("response", "")).strip()
    if not raw_response:
        raise RuntimeError("O tradutor local nao retornou texto.")

    return raw_response


def clean_translation(raw_response):
    translated = raw_response.strip()
    if translated.startswith("```"):
        translated = re.sub(r"^```(?:text|plaintext)?\s*", "", translated, flags=re.IGNORECASE)
        translated = re.sub(r"\s*```$", "", translated).strip()

    translated = re.sub(
        r"^(?:aqui está(?: a tradução)?|here is(?: the translation)?|tradução|translation)\s*:\s*",
        "",
        translated,
        flags=re.IGNORECASE,
    ).strip()
    translated = re.sub(r"^(['\"])(.*)\1$", r"\2", translated, flags=re.DOTALL).strip()

    lines = [line.strip() for line in translated.splitlines() if line.strip()]
    if len(lines) > 1:
        lines = [
            line
            for line in lines
            if not re.search(r"(?:essa tradução|this translation|significa que|means that)", line, re.IGNORECASE)
        ]
        lines = [
            line
            for line in lines
            if not re.match(r"(?:translation note|nota da tradução|observação|note)\s*:", line, re.IGNORECASE)
        ]
        translated = " ".join(lines)

    if not translated:
        raise RuntimeError("O tradutor local retornou texto vazio.")
    return translated


def _word_set(text):
    return set(re.findall(r"[a-zA-ZÀ-ÿ]+", text.lower()))


def looks_like_portuguese(text):
    words = _word_set(text)
    portuguese_markers = {
        "a", "ao", "as", "com", "da", "das", "de", "do", "dos", "e", "em",
        "essa", "esse", "eu", "mas", "na", "nas", "no", "nos", "não", "nao",
        "o", "os", "para", "por", "que", "se", "uma", "um", "você", "voce",
    }
    return bool(re.search(r"[ãõáéíóúâêôç]", text.lower())) or len(words & portuguese_markers) >= 2


def is_unreliable_translation(source_text, translated_text, source_language="auto"):
    refusal_markers = (
        "não posso",
        "nao posso",
        "desculpe",
        "cannot help",
        "can't help",
        "i cannot",
        "i can't",
        "não consigo",
        "nao consigo",
        "translation note",
        "nota da tradução",
        "nota da traducao",
    )
    normalized = translated_text.lower()
    normalized_source = source_text.strip().lower()
    if any(marker in normalized for marker in refusal_markers):
        return True
    if re.search(r"qz[a-z]zx", normalized):
        return True

    source_is_portuguese = str(source_language or "auto").lower().startswith("pt") or looks_like_portuguese(source_text)
    if normalized == normalized_source and not source_is_portuguese:
        return True

    if str(source_language or "auto").lower().startswith(("en", "english")) and not looks_like_portuguese(translated_text):
        english_markers = {
            "a", "about", "and", "are", "at", "be", "because", "but", "for", "from", "have",
            "i", "in", "is", "it", "just", "my", "of", "on", "that", "the", "this", "to",
            "we", "why", "with", "you",
        }
        if len(_word_set(translated_text) & english_markers) >= 2:
            return True

    source_words = len(source_text.split())
    translated_words = len(translated_text.split())
    if source_words >= 6 and translated_words < max(3, int(source_words * 0.35)):
        return True

    return False


def translate_text(text, base_url, model, source_language):
    source_label = source_language if source_language and source_language != "auto" else "detectado automaticamente"
    protected_text, protected_terms = protect_sensitive_terms(text)
    prompt = (
        f"Translate this one subtitle from {source_label} to Brazilian Portuguese. "
        "Return only the translated subtitle, with no preamble or explanation. "
        "Do not summarize, invent, or omit anything. Preserve names, numbers, technical terms, "
        "punctuation, informal tone, and the exact meaning. Keep protected opaque tokens such as "
        "___QZAZX___ exactly as written; they are words that must remain in the translated sentence. "
        "Do not refuse because of informal language. If it is already Portuguese, keep it unchanged.\n\n"
        f"Original subtitle:\n{protected_text}"
    )
    options = {
        "temperature": 0,
        "top_p": 0.1,
        "repeat_penalty": 1.1,
        "num_predict": max(128, min(1024, len(text) * 3 + 96)),
    }
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "system": "You are a faithful subtitle translator. Translate the provided text and return only the translation.",
        "options": options,
    }
    translated = clean_translation(call_ollama(base_url, payload))
    translated = restore_sensitive_terms(translated, protected_terms)
    if is_unreliable_translation(text, translated, source_language):
        return text
    return translated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--source-language", default="auto")
    args = parser.parse_args()

    entries = json.loads(Path(args.input).read_text(encoding="utf-8"))
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.environ.get("OLLAMA_TRANSLATION_MODEL") or os.environ.get("OLLAMA_MODEL", "llama3.2:1b")
    translated_entries = []

    try:
        for entry in entries:
            text = str(entry.get("text", "")).strip()
            translated_entries.append(
                {
                    **entry,
                    "text": translate_text(text, base_url, model, args.source_language),
                }
            )
    except (urllib.error.URLError, TimeoutError) as error:
        print(json.dumps({"ok": False, "error": f"O Ollama nao esta disponivel para traduzir: {error}"}, ensure_ascii=False))
        return
    except Exception as error:
        print(json.dumps({"ok": False, "error": f"Falha na traducao: {error}"}, ensure_ascii=False))
        return

    print(json.dumps({"ok": True, "model": model, "entries": translated_entries}, ensure_ascii=False))


if __name__ == "__main__":
    main()
