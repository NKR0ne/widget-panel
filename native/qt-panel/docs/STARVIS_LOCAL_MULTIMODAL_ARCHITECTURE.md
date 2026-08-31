# Starvis Local Multimodal Architecture

## Decision

Build Starvis around provider-neutral asynchronous operations. Keep the current
providers working while migrating them behind `LLMBackend`, `VisionBackend`,
`STTBackend`, and `TTSBackend`. Every backend request must return a
`BackendOperation` that streams partial output and propagates cancellation to
the underlying network reply, process, or decoder.

The local path remains the default privacy path. Cloud providers remain
optional fallbacks and must never receive camera frames or attachments unless
the user explicitly selects them.

## Hardware Profile

Target: RTX 3080 FE 10 GB, Xeon W-2235 6C/12T, 64 GB quad-channel DDR4.

The 27B GGUF will not fit entirely in VRAM. Its quantized weights plus KV cache,
vision projector, Qt rendering, and driver allocations require partial CPU/RAM
offload. Start with these settings and tune from measured LM Studio estimates:

| Setting | Initial value | Reason |
| --- | --- | --- |
| Model | Official Qwen3.8-27B GGUF | Establish a reliable baseline before community finetunes |
| Quantization | IQ4_XS, otherwise Q4_K_M | IQ4_XS reduces RAM/transfer pressure; Q4_K_M favors quality |
| Context | 8192 tokens | Lower first-token latency and KV pressure on 10 GB VRAM |
| Flash Attention | Enabled | Reduces attention memory and improves throughput when supported |
| GPU offload | LM Studio auto, then measured manual limit | Reserve at least 1.5-2 GB for Qt, display, and camera work |
| Reasoning | Off by default | Enable per request; do not impose thinking latency on voice turns |
| Vision | On-demand only in the 27B path | Avoid repeatedly feeding continuous camera frames to the large model |

Use `lms load --estimate-only <model-key> --context-length 8192 --gpu max`
before loading, then reduce GPU offload until the desktop and camera remain
stable. Increase context to 16K only after latency and memory measurements pass.

`Qwen3.8-27B-OBLITERATED` is a community derivative, not the baseline. It may
change refusals, instruction following, tool behavior, or output stability.
Keep the model identifier configurable and qualify that derivative with the
same tool-use, French, vision, hallucination, and cancellation tests as the
official model before making it the default.

## Capability Allocation

| Capability | Primary local backend | Fallback | Execution policy |
| --- | --- | --- | --- |
| Conversation/reasoning | LM Studio, Qwen3.8-27B | Existing cloud provider or smaller local model | Partial GPU offload; one generation at a time |
| Attached image/screenshot | LM Studio multimodal request with projector | Existing Qwen3-VL 8B service | User initiated |
| Continuous camera analysis | Existing Qwen3-VL 8B service | Motion metadata only | Event driven; do not route every frame through 27B |
| Speech recognition | Parakeet-TDT-0.6B-v3 Q8 via NeMo-Speech.cpp | faster-whisper Large-v3-Turbo, then current ASR | Prefer CPU or a bounded GPU allocation |
| Speech synthesis | Chatterbox Multilingual V3 after benchmark | Piper, then Windows TTS | Generate sentence chunks; keep Piper for immediate/offline speech |
| Future synthesis | Qwen3-TTS 0.6B adapter | Chatterbox/Piper | Optional, never coupled to the pipeline |

Parakeet v3 supports automatic language detection for French and English and
has an official Q8 GGUF path through NeMo-Speech.cpp. This is preferable to a
large Python/NeMo process for the initial native deployment.

Chatterbox Multilingual V3 supports French and English, but its reference
implementation generates a complete waveform per call. Treat sentence-level
requests as incremental playback, not as true sample streaming. Benchmark
time-to-first-audio and real-time factor on this CPU/GPU before replacing Piper.

## Operation Contract

`BackendOperation` is the common lifecycle:

`Pending -> Running -> Completed | Failed`

`Pending | Running -> Cancelling -> Cancelled`

It carries text, thinking, transcript, and PCM audio deltas. Cancellation
handlers abort the actual transport or inference job. A 1.5-second guard moves
a broken backend out of `Cancelling`, preventing a permanently stuck UI.

`StreamingTextSegmenter` converts token deltas into complete sentence-sized TTS
work units. This permits audio generation to start before the LLM finishes and
bounds latency when output has no punctuation.

## Migration Order

1. Add the common operation and backend interfaces with lifecycle tests.
2. Implement an OpenAI-compatible LM Studio adapter with SSE streaming,
   multimodal messages, reasoning controls, and abortable requests.
3. Route current local text chat through that adapter while preserving the
   existing Starvis QML signals.
4. Add a NeMo-Speech.cpp Parakeet adapter and push-to-talk capture.
5. Add Chatterbox and Piper TTS adapters plus sentence queue playback.
6. Add screenshot/image attachment and on-demand 27B vision.
7. Add VAD conversation mode and barge-in only after push-to-talk latency,
   cancellation, and resource-contention benchmarks pass.

## Acceptance Metrics

Record cold and warm results separately:

- UI cancellation feedback below 100 ms.
- Transport or decoder cancellation below 1.5 seconds.
- Visible first LLM token target below 2.5 seconds.
- Final STT transcript target below 1 second after push-to-talk release.
- First TTS audio target below 1.5 seconds after the first complete sentence.
- No UI-thread stalls above 50 ms during capture, inference, or playback.
- No display-driver resets or camera starvation during simultaneous operation.
