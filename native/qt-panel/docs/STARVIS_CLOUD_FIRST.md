# Starvis cloud-first trial

## Required credentials

Store credentials from Settings > Starvis. They are written through
`SecretVault`; do not add them to settings JSON or source files.

| Secret | Required | Purpose |
| --- | --- | --- |
| `starvis-openai-key` | Yes | GPT-5.6 Terra/Sol reasoning and OpenAI TTS |
| `starvis-groq-key` | Yes for Groq voice | Whisper Large V3 speech recognition |
| `starvis-anthropic-key` | No | Legacy Anthropic reasoning or explicitly enabled cloud vision |

No ChatGPT user subscription is required. The OpenAI API project needs its own
usage billing and provider-side spending limit.

## Recommended configuration

- Reasoning provider: OpenAI
- Routing: Automatic
- Routine model: `gpt-5.6-terra`
- Frontier model: `gpt-5.6-sol`
- Application monthly budget: USD 25
- Conversation recognition: Groq Whisper Large V3
- Speech output: OpenAI, with Piper as the offline fallback
- Cloud vision: disabled
- Local models: enabled in the hybrid profile

The hybrid runtime loads local Qwen3-VL and Piper only. Local reasoning and ASR
are stopped so they do not reserve GPU memory. Switching reasoning back to the
local provider restores the complete local runtime.

## Privacy boundary

Camera images remain local by default. Enabling cloud vision allows an image to
leave the workstation only when the application explicitly requests a cloud
classification; it does not authorize continuous frame upload. OpenAI reasoning
receives the existing weather, market, workstation, and news context snapshot.
Mail bodies, calendar descriptions, credentials, and camera frames are not part
of that context snapshot.

## Cost controls

QtPanel records monthly OpenAI token usage, OpenAI TTS characters, Groq billed
audio seconds, Terra requests, and Sol requests. New OpenAI reasoning and TTS
requests are blocked after the configured application budget is reached. This is
a secondary guard; configure provider-side limits because local accounting cannot
prevent charges from another client using the same API project.
