"""Chatterbox Multilingual V3 service with an OpenAI-compatible TTS endpoint."""

from __future__ import annotations

import io
import os
import threading
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from chatterbox.mtl_tts import ChatterboxMultilingualTTS


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=1200)
    model: str = "chatterbox-multilingual-v3"
    voice: str = "V3 Default"
    language: str = "fr"
    speed: float = Field(default=1.0, ge=0.6, le=1.5)
    response_format: str = "wav"
    exaggeration: float = Field(default=0.5, ge=0.0, le=1.0)
    cfg_weight: float = Field(default=0.5, ge=0.0, le=1.0)


class Runtime:
    def __init__(self) -> None:
        requested = os.environ.get("STARVIS_CHATTERBOX_DEVICE", "auto").lower()
        self.device = "cuda" if requested == "auto" and torch.cuda.is_available() else requested
        if self.device not in {"cpu", "cuda"}:
            self.device = "cpu"
        self.model = None
        self.error = ""
        self.loading = False
        self.lock = threading.RLock()

    def load(self):
        with self.lock:
            if self.model is not None:
                return self.model
            self.loading = True
            try:
                started = time.monotonic()
                model_dir = Path(os.environ.get("STARVIS_CHATTERBOX_MODEL_DIR", ""))
                required = {
                    "ve.pt",
                    "t3_mtl23ls_v3.safetensors",
                    "s3gen.pt",
                    "grapheme_mtl_merged_expanded_v1.json",
                    "conds.pt",
                    "Cangjie5_TC.json",
                }
                device = torch.device(self.device)
                if model_dir.is_dir() and all((model_dir / name).is_file() for name in required):
                    self.model = ChatterboxMultilingualTTS.from_local(
                        model_dir, device=device, t3_model="v3"
                    )
                else:
                    self.model = ChatterboxMultilingualTTS.from_pretrained(
                        device=device, t3_model="v3"
                    )
                self.error = ""
                print(
                    f"[tts] Chatterbox Multilingual V3 loaded on {self.device} "
                    f"in {time.monotonic() - started:.2f}s",
                    flush=True,
                )
                return self.model
            except Exception as exc:
                self.error = str(exc)
                raise
            finally:
                self.loading = False


runtime = Runtime()


def preload() -> None:
    try:
        runtime.load()
    except Exception as exc:
        print(f"[tts] Chatterbox preload failed: {exc}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=preload, daemon=True, name="chatterbox-preload").start()
    yield


app = FastAPI(
    title="Starvis Chatterbox TTS",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


@app.get("/health")
def health():
    return {
        "status": "ok" if runtime.model is not None else "setup",
        "asrReady": False,
        "ttsReady": runtime.model is not None,
        "provider": "Chatterbox Multilingual V3",
        "model": "chatterbox-multilingual-v3",
        "device": runtime.device,
        "loading": runtime.loading,
        "error": runtime.error,
        "voices": ["V3 Default"],
    }


@app.get("/v1/audio/voices")
def voices():
    return {"data": [{"id": "V3 Default", "language": "multilingual"}]}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    if request.response_format.lower() != "wav":
        raise HTTPException(400, "Chatterbox runtime currently returns WAV audio")
    language = request.language.strip().lower().split("-")[0] or "fr"
    if language not in {"en", "fr"}:
        raise HTTPException(400, f"Starvis currently enables English and French, not {language}")
    started = time.monotonic()
    try:
        with runtime.lock:
            model = runtime.load()
            audio = model.generate(
                request.input.strip(),
                language_id=language,
                exaggeration=request.exaggeration,
                cfg_weight=request.cfg_weight,
            )
            samples = audio.detach().float().cpu().clamp(-1.0, 1.0)
            if samples.ndim > 1:
                samples = samples[0]
            pcm = (samples * 32767.0).to(torch.int16).numpy().tobytes()
            output = io.BytesIO()
            with wave.open(output, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(model.sr)
                wav_file.writeframes(pcm)
        print(
            f"[tts] synthesized {language} in {time.monotonic() - started:.2f}s",
            flush=True,
        )
        return Response(output.getvalue(), media_type="audio/wav")
    except Exception as exc:
        if runtime.device == "cuda" and "out of memory" in str(exc).lower():
            torch.cuda.empty_cache()
        raise HTTPException(500, f"Chatterbox TTS failed: {exc}") from exc


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("STARVIS_TTS_PORT", "1237")),
        log_level="info",
    )
