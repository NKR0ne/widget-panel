"""Local Qwen ASR service for QtPanel, isolated from speech synthesis."""

from __future__ import annotations

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
from qwen_asr import Qwen3ASRModel

ROOT = Path(os.environ.get("STARVIS_MODEL_ROOT", r"M:\LLModels"))
ASR_PATH = Path(os.environ.get("STARVIS_ASR_MODEL", ROOT / "Qwen3-ASR-1.7B"))
DEVICE_POLICY = os.environ.get("STARVIS_ASR_DEVICE", "auto").strip().lower()
MIN_CUDA_FREE_MIB = int(os.environ.get("STARVIS_ASR_MIN_CUDA_MIB", "3000"))


class Runtime:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.model = None
        self.device = "none"

    @staticmethod
    def cuda_free_mib() -> int:
        if not torch.cuda.is_available():
            return 0
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                check=True, capture_output=True, text=True, timeout=3,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return int(result.stdout.splitlines()[0].strip())
        except Exception:
            return 0

    def choose_device(self) -> str:
        if DEVICE_POLICY == "cpu":
            return "cpu"
        if DEVICE_POLICY.startswith("cuda"):
            return DEVICE_POLICY
        return "cuda:0" if self.cuda_free_mib() >= MIN_CUDA_FREE_MIB else "cpu"

    def load(self):
        with self.lock:
            if self.model is not None:
                return self.model
            device = self.choose_device()
            dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
            try:
                model = Qwen3ASRModel.from_pretrained(
                    str(ASR_PATH), device_map=device, dtype=dtype,
                    max_inference_batch_size=1, max_new_tokens=256,
                )
            except torch.OutOfMemoryError:
                torch.cuda.empty_cache()
                device = "cpu"
                model = Qwen3ASRModel.from_pretrained(
                    str(ASR_PATH), device_map=device, dtype=torch.float32,
                    max_inference_batch_size=1, max_new_tokens=256,
                )
            self.model = model
            self.device = device
            print(f"[asr] loaded Qwen3-ASR on {device}", flush=True)
            return model


runtime = Runtime()
app = FastAPI(title="Starvis local ASR", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {
        "status": "ok" if ASR_PATH.exists() else "setup",
        "asrReady": ASR_PATH.exists(), "ttsReady": False,
        "model": "Qwen3-ASR-1.7B", "loaded": runtime.model is not None,
        "device": runtime.device, "devicePolicy": DEVICE_POLICY,
        "cudaFreeMiB": runtime.cuda_free_mib(),
    }


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), language: str = Form("French"),
               context: str = Form("")):
    if not ASR_PATH.exists():
        raise HTTPException(503, f"ASR model missing: {ASR_PATH}")
    started = time.monotonic()
    try:
        audio, sample_rate = sf.read(io.BytesIO(file.file.read()), dtype="float32")
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)
        with runtime.lock:
            result = runtime.load().transcribe(
                audio=(audio, sample_rate), context=context, language=language or None,
            )[0]
        print(f"[asr] transcribed in {time.monotonic() - started:.2f}s", flush=True)
        return {"text": result.text.strip(), "language": result.language}
    except Exception as exc:
        raise HTTPException(500, f"ASR failed: {exc}") from exc


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1",
                port=int(os.environ.get("STARVIS_ASR_PORT", "1235")), log_level="info")
