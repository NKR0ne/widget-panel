# Starvis local runtime

Starvis uses four independent localhost services. A slow or unavailable
capability does not block readiness for the others.

| Capability | Port | Runtime | Model | Device |
|---|---:|---|---|---|
| Reasoning and tools | 1234 | llama.cpp | Qwen3-4B Q5_K_M | CUDA |
| Speech recognition | 1235 | NeMo Speech OpenAI API | Parakeet-TDT-0.6B-v3 Q8 | CPU by default; Qwen ASR fallback |
| Vision | 1236 | llama.cpp | Qwen3-VL-8B Instruct Q4_K_M | partial CUDA offload |
| Speech synthesis | 1237 | FastAPI / Piper | Tom, Pierre, Jessica fr-FR medium | CPU |

Use the global local-model control in the QtPanel header to start or stop all
four services. The implementation calls:

```powershell
powershell -ExecutionPolicy Bypass -File native\qt-panel\scripts\set-starvis-local-models.ps1 enable
powershell -ExecutionPolicy Bypass -File native\qt-panel\scripts\set-starvis-local-models.ps1 disable
```

The disable action verifies the process owning each port before terminating it.
It also recognizes the previous LM Studio and shared Qwen ASR/TTS deployment so
an existing installation can migrate without leaving a port occupied.

## Readiness

- Reasoning and vision validate their model aliases through `/v1/models`.
- ASR exposes NeMo Speech `/ready` and `/health` endpoints; the Qwen fallback
  and TTS expose nonblocking `/health` endpoints.
- QtPanel probes all capabilities independently and reports their state in
  Settings > Starvis.
- Local voice conversations require ASR readiness, not TTS readiness. Spoken
  output can fall back to Windows independently.

## Post-deployment benchmark

The Qwen fallback was measured on the RTX 3080 workstation on 2026-08-27:

| Operation | Result |
|---|---|
| Qwen3-4B first token | 0.321 s |
| Qwen3-4B generation | 99.74 tokens/s |
| Tool selection | correct in 0.319 s |
| Vision fixture | 3.467 s; scene structure correct, small OCR imperfect |
| Piper Tom API | 3.001 s warm |
| Piper Pierre API | 2.144 s warm |
| Piper Jessica API | 0.141 s after shared model load |
| Parakeet Q8 CPU synthetic French fixture | 1.25 s; meaning correct, one word-boundary error |
| Qwen3-ASR fallback cold | 9.645 s, exact transcript |
| Qwen3-ASR fallback warm CPU | 4.781 s, exact transcript |

Parakeet is the primary recognizer. The first deployed CPU measurement is
approximately four times faster than the warm Qwen fallback. The Qwen
fallback's estimated steady-state voice turn is 5–8 seconds, compared with
79.6 seconds for the former shared Qwen ASR/TTS model-swapping path.

## Limits

- The 10 GB GPU is nearly full when reasoning and vision are both resident, so
  Parakeet ASR normally uses the CPU build. This is intentional and avoids
  out-of-memory failures while the reasoning and vision models are resident.
- Qwen3-VL is suitable for people, vehicles, scene state, and broad visual
  reasoning. Small text and license-plate OCR should use a dedicated OCR stage
  before treating the result as authoritative.
- Piper prioritizes latency and reliability over expressive studio speech.
