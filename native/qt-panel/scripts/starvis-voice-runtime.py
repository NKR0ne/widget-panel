"""Local Qwen ASR/TTS service for QtPanel.

The service is intentionally localhost-only and lazy-loads one speech model at
a time. On a 10 GB RTX 3080 the resident vision model leaves too little VRAM
for either speech model, so `auto` uses CUDA only when enough memory is free and
otherwise runs speech on system RAM without interrupting Starvis vision.
"""

from __future__ import annotations

import gc
import io
import os
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from qwen_asr import Qwen3ASRModel
from qwen_tts import Qwen3TTSModel


ROOT = Path(os.environ.get("STARVIS_MODEL_ROOT", r"M:\LLModels"))
ASR_PATH = Path(os.environ.get("STARVIS_ASR_MODEL", ROOT / "Qwen3-ASR-1.7B"))
TTS_PATH = Path(
    os.environ.get(
        "STARVIS_TTS_MODEL", ROOT / "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    )
)
DEVICE_POLICY = os.environ.get("STARVIS_SPEECH_DEVICE", "auto").strip().lower()
MIN_CUDA_FREE_MIB = int(os.environ.get("STARVIS_SPEECH_MIN_CUDA_MIB", "5200"))
MODEL_IDLE_SECONDS = int(os.environ.get("STARVIS_SPEECH_MODEL_IDLE_SECONDS", "90"))
PREWARM_TTS = os.environ.get("STARVIS_SPEECH_PREWARM_TTS", "1") != "0"
SPEAKERS = (
    "Vivian",
    "Serena",
    "Uncle_Fu",
    "Dylan",
    "Eric",
    "Ryan",
    "Aiden",
    "Ono_Anna",
    "Sohee",
)


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=3600)
    voice: str = "Ryan"
    language: str = "French"
    instruct: str = ""
    response_format: str = "wav"


class Runtime:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.model = None
        self.kind = "none"
        self.device = "none"
        self.loaded_at = 0.0
        self.last_used_at = 0.0

    @staticmethod
    def cuda_free_mib() -> int:
        if not torch.cuda.is_available():
            return 0
        try:
            # `torch.cuda.mem_get_info()` can over-report free memory when a
            # llama.cpp CUDA VMM allocation belongs to another process. NVML's
            # value, exposed by nvidia-smi, reflects the whole adapter.
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=memory.free",
                    "--format=csv,noheader,nounits",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=3,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return int(result.stdout.splitlines()[0].strip())
        except Exception:
            pass
        try:
            free_bytes, _ = torch.cuda.mem_get_info()
            return int(free_bytes / (1024 * 1024))
        except Exception:
            return 0

    def choose_device(self) -> str:
        if DEVICE_POLICY == "cpu":
            return "cpu"
        if DEVICE_POLICY.startswith("cuda"):
            return DEVICE_POLICY
        return "cuda:0" if self.cuda_free_mib() >= MIN_CUDA_FREE_MIB else "cpu"

    def unload(self) -> None:
        self.model = None
        self.kind = "none"
        self.device = "none"
        self.loaded_at = 0.0
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def load(self, kind: str):
        with self.lock:
            if self.kind == kind and self.model is not None:
                self.last_used_at = time.monotonic()
                return self.model
            self.unload()
            device = self.choose_device()
            dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
            common = {"device_map": device, "dtype": dtype}
            try:
                if kind == "asr":
                    model = Qwen3ASRModel.from_pretrained(
                        str(ASR_PATH),
                        max_inference_batch_size=1,
                        max_new_tokens=256,
                        **common,
                    )
                elif kind == "tts":
                    model = Qwen3TTSModel.from_pretrained(str(TTS_PATH), **common)
                else:
                    raise ValueError(f"unknown model kind: {kind}")
            except torch.OutOfMemoryError:
                self.unload()
                if device == "cpu":
                    raise
                # Another local model may have claimed VRAM after the initial
                # check. Retrying on CPU keeps voice functional and bounded.
                common = {"device_map": "cpu", "dtype": torch.float32}
                if kind == "asr":
                    model = Qwen3ASRModel.from_pretrained(
                        str(ASR_PATH),
                        max_inference_batch_size=1,
                        max_new_tokens=256,
                        **common,
                    )
                else:
                    model = Qwen3TTSModel.from_pretrained(str(TTS_PATH), **common)
                device = "cpu"
            self.model = model
            self.kind = kind
            self.device = device
            self.loaded_at = time.monotonic()
            self.last_used_at = self.loaded_at
            print(f"[speech] loaded {kind} on {device}", flush=True)
            return model

    def touch(self) -> None:
        self.last_used_at = time.monotonic()


runtime = Runtime()
app = FastAPI(title="Starvis local speech", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    with runtime.lock:
        return {
            "status": "ok" if ASR_PATH.exists() and TTS_PATH.exists() else "setup",
            "asrReady": ASR_PATH.exists(),
            "ttsReady": TTS_PATH.exists(),
            "model": runtime.kind,
            "device": runtime.device,
            "devicePolicy": DEVICE_POLICY,
            "cudaFreeMiB": runtime.cuda_free_mib(),
            "voices": list(SPEAKERS),
        }


@app.post("/v1/audio/transcriptions")
def transcribe(
    file: UploadFile = File(...),
    language: str = Form("French"),
    context: str = Form(""),
):
    if not ASR_PATH.exists():
        raise HTTPException(503, f"ASR model missing: {ASR_PATH}")
    try:
        audio, sample_rate = sf.read(io.BytesIO(file.file.read()), dtype="float32")
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)
        with runtime.lock:
            model = runtime.load("asr")
            result = model.transcribe(
                audio=(audio, sample_rate),
                context=context,
                language=language or None,
            )[0]
            runtime.touch()
        return {"text": result.text.strip(), "language": result.language}
    except Exception as exc:
        raise HTTPException(500, f"ASR failed: {exc}") from exc


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    if not TTS_PATH.exists():
        raise HTTPException(503, f"TTS model missing: {TTS_PATH}")
    speaker = request.voice.strip()
    if speaker.lower() not in {name.lower() for name in SPEAKERS}:
        raise HTTPException(400, f"Unsupported voice: {speaker}")
    speaker = next(name for name in SPEAKERS if name.lower() == speaker.lower())
    started = time.monotonic()
    try:
        with runtime.lock:
            model = runtime.load("tts")
            wavs, sample_rate = model.generate_custom_voice(
                text=request.input.strip(),
                speaker=speaker,
                language=request.language or "French",
                instruct=request.instruct or "",
                max_new_tokens=2048,
            )
            runtime.touch()
        output = io.BytesIO()
        sf.write(output, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
        print(
            f"[speech] synthesized {speaker} in {time.monotonic() - started:.2f}s",
            flush=True,
        )
        return Response(output.getvalue(), media_type="audio/wav")
    except Exception as exc:
        raise HTTPException(500, f"TTS failed: {exc}") from exc


def idle_unloader() -> None:
    while True:
        time.sleep(10)
        with runtime.lock:
            if (
                runtime.model is not None
                and time.monotonic() - runtime.last_used_at >= MODEL_IDLE_SECONDS
            ):
                runtime.unload()


def prewarm_tts() -> None:
    # Let LM Studio finish its small GPU allocation first, then absorb the
    # one-time model load before the user opens Starvis settings.
    time.sleep(12)
    try:
        with runtime.lock:
            if runtime.model is None and runtime.choose_device().startswith("cuda"):
                runtime.load("tts")
    except Exception as exc:
        print(f"[speech] TTS prewarm skipped: {exc}", flush=True)


@app.on_event("startup")
def start_idle_unloader() -> None:
    threading.Thread(target=idle_unloader, name="model-idle-unloader", daemon=True).start()
    if PREWARM_TTS:
        threading.Thread(target=prewarm_tts, name="tts-prewarm", daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("STARVIS_SPEECH_PORT", "1235"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
