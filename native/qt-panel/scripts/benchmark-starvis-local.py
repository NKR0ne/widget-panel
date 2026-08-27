"""Benchmark the local Starvis reasoning, vision, ASR, and TTS endpoints."""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import subprocess
import time
import unicodedata
from pathlib import Path

import requests
import soundfile as sf
from PIL import Image, ImageDraw


REASONING_URL = "http://127.0.0.1:1234/v1"
SPEECH_URL = "http://127.0.0.1:1235/v1"
REFERENCE_TEXT = (
    "Bonjour Nicolas. Starvis analyse la meteo, les nouvelles et les performances "
    "de la station. Le processeur est stable et aucun evenement urgent ne demande "
    "votre attention."
)


def gpu_snapshot() -> dict:
    fields = "memory.used,memory.free,utilization.gpu,temperature.gpu"
    result = subprocess.run(
        ["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    used, free, utilization, temperature = [
        int(value.strip()) for value in result.stdout.splitlines()[0].split(",")
    ]
    return {
        "usedMiB": used,
        "freeMiB": free,
        "utilizationPct": utilization,
        "temperatureC": temperature,
    }


def normalize_words(text: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", text.lower())
    folded = "".join(char for char in folded if not unicodedata.combining(char))
    return re.findall(r"[a-z0-9]+", folded)


def word_error_rate(reference: str, hypothesis: str) -> float:
    expected = normalize_words(reference)
    actual = normalize_words(hypothesis)
    previous = list(range(len(actual) + 1))
    for row, expected_word in enumerate(expected, start=1):
        current = [row]
        for column, actual_word in enumerate(actual, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (expected_word != actual_word),
                )
            )
        previous = current
    return previous[-1] / max(1, len(expected))


def speech_health() -> dict:
    response = requests.get(SPEECH_URL.removesuffix("/v1") + "/health", timeout=10)
    response.raise_for_status()
    return response.json()


def reasoning_run(prompt: str, max_tokens: int = 160) -> dict:
    payload = {
        "model": "starvis-local",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    started = time.perf_counter()
    first_token = None
    text_parts: list[str] = []
    usage = {}
    with requests.post(
        f"{REASONING_URL}/chat/completions",
        json=payload,
        stream=True,
        timeout=(10, 300),
    ) as response:
        response.raise_for_status()
        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith("data: "):
                continue
            body = raw_line[6:]
            if body == "[DONE]":
                break
            event = json.loads(body)
            if event.get("usage"):
                usage = event["usage"]
            choices = event.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            chunk = delta.get("content") or delta.get("reasoning_content") or ""
            if chunk:
                if first_token is None:
                    first_token = time.perf_counter()
                text_parts.append(chunk)
    finished = time.perf_counter()
    completion_tokens = int(usage.get("completion_tokens") or 0)
    generation_seconds = max(0.001, finished - (first_token or started))
    return {
        "totalSeconds": round(finished - started, 3),
        "timeToFirstTokenSeconds": round((first_token or finished) - started, 3),
        "completionTokens": completion_tokens,
        "tokensPerSecond": round(completion_tokens / generation_seconds, 2),
        "text": "".join(text_parts).strip(),
        "usage": usage,
        "gpu": gpu_snapshot(),
    }


def reasoning_tool_run() -> dict:
    payload = {
        "model": "starvis-local",
        "messages": [
            {
                "role": "user",
                "content": (
                    "Use the get_station_status tool now. Do not answer from memory."
                ),
            }
        ],
        "temperature": 0,
        "max_tokens": 384,
        "chat_template_kwargs": {"enable_thinking": False},
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_station_status",
                    "description": "Read the current workstation status.",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
        "tool_choice": "auto",
        "stream": False,
    }
    before = gpu_snapshot()
    started = time.perf_counter()
    response = requests.post(
        f"{REASONING_URL}/chat/completions", json=payload, timeout=300
    )
    elapsed = time.perf_counter() - started
    response.raise_for_status()
    message = response.json()["choices"][0]["message"]
    calls = message.get("tool_calls") or []
    return {
        "seconds": round(elapsed, 3),
        "correct": bool(calls)
        and calls[0].get("function", {}).get("name") == "get_station_status",
        "message": message,
        "gpuBefore": before,
        "gpuAfter": gpu_snapshot(),
    }


def tts_run(output_path: Path, label: str) -> dict:
    payload = {
        "model": "qwen3-tts",
        "voice": "Dylan",
        "language": "French",
        "input": REFERENCE_TEXT,
        "response_format": "wav",
    }
    before = gpu_snapshot()
    started = time.perf_counter()
    response = requests.post(
        f"{SPEECH_URL}/audio/speech", json=payload, timeout=300
    )
    elapsed = time.perf_counter() - started
    response.raise_for_status()
    output_path.write_bytes(response.content)
    audio = sf.info(output_path)
    return {
        "label": label,
        "seconds": round(elapsed, 3),
        "audioSeconds": round(audio.duration, 3),
        "realTimeFactor": round(elapsed / audio.duration, 3),
        "bytes": len(response.content),
        "health": speech_health(),
        "gpuBefore": before,
        "gpuAfter": gpu_snapshot(),
    }


def asr_run(audio_path: Path, label: str) -> dict:
    audio = sf.info(audio_path)
    before = gpu_snapshot()
    started = time.perf_counter()
    with audio_path.open("rb") as source:
        response = requests.post(
            f"{SPEECH_URL}/audio/transcriptions",
            files={"file": (audio_path.name, source, "audio/wav")},
            data={"language": "French", "context": "Starvis QtPanel"},
            timeout=300,
        )
    elapsed = time.perf_counter() - started
    response.raise_for_status()
    payload = response.json()
    transcript = str(payload.get("text") or "")
    return {
        "label": label,
        "seconds": round(elapsed, 3),
        "audioSeconds": round(audio.duration, 3),
        "realTimeFactor": round(elapsed / audio.duration, 3),
        "wordErrorRate": round(word_error_rate(REFERENCE_TEXT, transcript), 3),
        "transcript": transcript,
        "health": speech_health(),
        "gpuBefore": before,
        "gpuAfter": gpu_snapshot(),
    }


def create_vision_fixture(path: Path) -> None:
    image = Image.new("RGB", (960, 540), "#e8edf3")
    draw = ImageDraw.Draw(image)
    draw.rectangle((80, 75, 880, 465), fill="#ffffff", outline="#26364a", width=8)
    draw.rectangle((150, 155, 360, 365), fill="#d83b3b")
    draw.ellipse((565, 155, 775, 365), fill="#2878d0")
    draw.text((360, 405), "STARVIS 42", fill="#111111", stroke_width=1)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")


def vision_run(image_path: Path, endpoint: str, model: str) -> dict:
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{encoded}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Return only JSON with keys redSquares, blueCircles, text. "
                            "Count the shapes and transcribe the visible label."
                        ),
                    },
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": 128,
        "stream": False,
    }
    before = gpu_snapshot()
    started = time.perf_counter()
    try:
        response = requests.post(
            f"{endpoint.rstrip('/')}/chat/completions", json=payload, timeout=300
        )
        elapsed = time.perf_counter() - started
        response.raise_for_status()
        body = response.json()
        content = body["choices"][0]["message"]["content"]
        compact = re.search(r"\{.*\}", content, flags=re.DOTALL)
        parsed = json.loads(compact.group(0)) if compact else {}
        correct = (
            parsed.get("redSquares") == 1
            and parsed.get("blueCircles") == 1
            and "STARVIS 42" in str(parsed.get("text", "")).upper()
        )
        return {
            "seconds": round(elapsed, 3),
            "correct": correct,
            "response": content,
            "gpuBefore": before,
            "gpuAfter": gpu_snapshot(),
        }
    except Exception as exc:
        return {
            "seconds": round(time.perf_counter() - started, 3),
            "correct": False,
            "error": str(exc),
            "gpuBefore": before,
            "gpuAfter": gpu_snapshot(),
        }


def markdown_report(results: dict) -> str:
    reasoning = results["reasoning"]
    tts = results["tts"]
    asr = results["asr"]
    vision = results["vision"]
    pipeline = results["voicePipeline"]
    return "\n".join(
        [
            "# Starvis local model benchmark",
            "",
            f"Generated: {results['generatedAt']}",
            "",
            "| Function | Result | Key measurement |",
            "|---|---:|---|",
            (
                f"| Reasoning | "
                f"{'PASS' if reasoning['instructionPass'] else 'LIMITED'} | "
                f"TTFT {reasoning['measured']['timeToFirstTokenSeconds']} s; "
                f"{reasoning['measured']['tokensPerSecond']} tok/s |"
            ),
            (
                f"| Tool selection | "
                f"{'PASS' if reasoning['toolCall']['correct'] else 'FAIL'} | "
                f"{reasoning['toolCall']['seconds']} s |"
            ),
            (
                f"| Speech synthesis | "
                f"{'PASS' if tts['warm']['realTimeFactor'] < 0.5 else 'FAIL'} | "
                f"Warm RTF {tts['warm']['realTimeFactor']}; "
                f"ASR switch-back {tts['afterAsr']['seconds']} s |"
            ),
            (
                f"| Speech recognition | "
                f"{'PASS' if asr['warm']['wordErrorRate'] <= 0.15 else 'FAIL'} | "
                f"Warm RTF {asr['warm']['realTimeFactor']}; "
                f"WER {asr['warm']['wordErrorRate']} |"
            ),
            (
                f"| Vision through deployed alias | "
                f"{'PASS' if vision['correct'] else 'FAIL'} | "
                f"{vision.get('seconds')} s |"
            ),
            "",
            "## Voice turn",
            "",
            (
                f"Synthetic ASR -> reasoning -> TTS pipeline: "
                f"{pipeline['estimatedSeconds']} s. This includes the ASR-to-TTS "
                "model switch paid by the current single speech worker."
            ),
            "",
            "The JSON file beside this report contains transcripts, model output, GPU "
            "snapshots, and every individual timing.",
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--vision-endpoint", default=REASONING_URL)
    parser.add_argument("--vision-model", default="starvis-local")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    results: dict = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "gpuInitial": gpu_snapshot(),
        "speechInitial": speech_health(),
    }

    warmup = reasoning_run("Reponds uniquement: PRET", 24)
    measured = reasoning_run(
        "Reponds uniquement avec un objet JSON valide contenant result et status. "
        "result doit etre le produit de 37 par 24 et status doit etre ok.",
        256,
    )
    strict_json = False
    try:
        parsed = json.loads(measured["text"])
        strict_json = parsed.get("result") == 888 and parsed.get("status") == "ok"
    except (TypeError, ValueError):
        pass
    results["reasoning"] = {
        "warmup": warmup,
        "measured": measured,
        "arithmeticPass": "888" in measured["text"],
        "instructionPass": strict_json,
        "qualityPass": "888" in measured["text"] and "ok" in measured["text"].lower(),
        "toolCall": reasoning_tool_run(),
    }

    tts_audio = args.output_dir / "dylan-reference.wav"
    results["tts"] = {
        "warm": tts_run(tts_audio, "warm-or-current"),
        "secondWarm": tts_run(args.output_dir / "dylan-reference-2.wav", "warm"),
    }
    results["asr"] = {
        "afterTts": asr_run(tts_audio, "tts-to-asr-switch"),
        "warm": asr_run(tts_audio, "warm"),
    }
    results["tts"]["afterAsr"] = tts_run(
        args.output_dir / "dylan-after-asr.wav", "asr-to-tts-switch"
    )

    fixture = args.output_dir / "vision-fixture.png"
    create_vision_fixture(fixture)
    results["vision"] = vision_run(
        fixture, args.vision_endpoint, args.vision_model
    )
    results["voicePipeline"] = {
        "estimatedSeconds": round(
            results["asr"]["warm"]["seconds"]
            + measured["totalSeconds"]
            + results["tts"]["afterAsr"]["seconds"],
            3,
        )
    }
    results["gpuFinal"] = gpu_snapshot()

    json_path = args.output_dir / "benchmark.json"
    markdown_path = args.output_dir / "benchmark.md"
    json_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    markdown_path.write_text(markdown_report(results), encoding="utf-8")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
