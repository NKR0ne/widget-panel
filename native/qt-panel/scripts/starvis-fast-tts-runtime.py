"""Fast CPU Piper TTS service with an OpenAI-compatible speech endpoint."""

from __future__ import annotations

import io
import os
import threading
import time
import wave
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from piper import PiperVoice, SynthesisConfig
from pydantic import BaseModel, Field

ROOT = Path(os.environ.get("STARVIS_PIPER_ROOT", r"M:\LLModels\Piper"))
VOICE_SPECS = {
    "Tom": (ROOT / "fr_FR-tom-medium.onnx", None),
    "Jessica": (ROOT / "fr_FR-upmc-medium.onnx", 0),
    "Pierre": (ROOT / "fr_FR-upmc-medium.onnx", 1),
}
LEGACY_VOICES = {name.lower(): "Tom" for name in (
    "Dylan", "Ryan", "Aiden", "Eric", "Serena", "Vivian", "Uncle_Fu",
    "Ono_Anna", "Sohee",
)}


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=3600)
    voice: str = "Tom"
    speed: float = Field(default=1.0, ge=0.6, le=1.5)
    response_format: str = "wav"


class Runtime:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.models = {}

    def resolve(self, requested: str):
        name = requested.strip() or "Tom"
        canonical = next((item for item in VOICE_SPECS if item.lower() == name.lower()), None)
        if canonical is None:
            canonical = LEGACY_VOICES.get(name.lower())
        if canonical is None:
            raise ValueError(f"Unsupported voice: {requested}")
        model_path, speaker_id = VOICE_SPECS[canonical]
        return canonical, model_path, speaker_id

    def load(self, path: Path):
        model = self.models.get(path)
        if model is None:
            model = PiperVoice.load(path)
            self.models[path] = model
            print(f"[tts] loaded {path.name} on CPU", flush=True)
        return model


runtime = Runtime()
app = FastAPI(title="Starvis fast local TTS", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    ready = all(path.exists() and Path(str(path) + ".json").exists()
                for path, _ in VOICE_SPECS.values())
    return {
        "status": "ok" if ready else "setup", "asrReady": False,
        "ttsReady": ready, "provider": "Piper", "model": "fr_FR-medium",
        "device": "cpu", "voices": list(VOICE_SPECS),
    }


@app.get("/v1/audio/voices")
def voices():
    return {"data": [{"id": name, "language": "fr-FR"} for name in VOICE_SPECS]}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    if request.response_format.lower() != "wav":
        raise HTTPException(400, "Piper runtime currently returns WAV audio")
    started = time.monotonic()
    try:
        canonical, model_path, speaker_id = runtime.resolve(request.voice)
        if not model_path.exists():
            raise FileNotFoundError(model_path)
        output = io.BytesIO()
        with runtime.lock, wave.open(output, "wb") as wav_file:
            runtime.load(model_path).synthesize_wav(
                request.input.strip(), wav_file,
                syn_config=SynthesisConfig(
                    speaker_id=speaker_id, length_scale=1.0 / request.speed,
                ),
            )
        print(f"[tts] synthesized {canonical} in {time.monotonic() - started:.2f}s", flush=True)
        return Response(output.getvalue(), media_type="audio/wav")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"TTS failed: {exc}") from exc


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1",
                port=int(os.environ.get("STARVIS_TTS_PORT", "1237")), log_level="info")
