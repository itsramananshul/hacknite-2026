# Chalk model options — checked 27 September 2026

A local website and a local AI model are separate things. OpenCode Go runs through a local server but uses hosted inference. Native Ollama uses downloaded weights without a provider quota. Model quality and GPU memory still limit reliability.

## This laptop

RTX 5070 Laptop GPU, 8 GB VRAM, approximately 16 GB RAM. Ollama 0.18.1 is installed. Qwen3.5 4B has text and image input and fits the GPU. Arithmetic worked in live tests, but scene output was inconsistent. A valid scene is not proof of correct motion. Qwen2.5 Coder 7B crashed its model runner here. Qwen3.5 9B completed a text problem with correct free-fall motion in 153 seconds including repair. A photo test returned correct numerical answers but its scene failed validation. Treat this as a working local path with known scene-generation failures, not a general accuracy guarantee. The 9B model used both CPU and GPU memory on this 8 GB GPU.

Run `npm run dev:local`. `OLLAMA_MODEL` selects text/scene inference and `OLLAMA_VISION_MODEL` selects photo inference. The startup checks the downloaded model and binds to localhost. No Gemini key is required. Invalid scenes are rejected rather than executed or silently replaced with a preset.

## Hosted alternatives

| Provider | Useful models | Limits and practical findings |
|---|---|---|
| OpenCode Go | DeepSeek V4.1 Flash, V4 Flash, GLM 5.3 Flash, MiMo V2.6 Flash, Kimi K2.6 | Existing subscription; allowance windows apply. V4.1 completed a photo-to-validated-scene test in 31 seconds here. V4 Flash passed a text test in 36 seconds. GLM and MiMo passed simple tests but were slower. |
| Cerebras free trial | GPT-OSS 120B, Qwen3.8 27B | Current official table: 5 requests/minute, 30K uncached tokens/minute, 1M tokens/day. Needs a separate key; not tested here. |
| Groq free | GPT-OSS 120B/20B, Qwen3.8 27B | 30 requests/minute, 1,000/day, 8K tokens/minute, 200K tokens/day. Large prompts can hit token limits first. Needs a separate key. |
| OpenRouter free | Qwen3.8 27B, Gemma4 26B-A4B/31B, Nemotron3 Nano Omni 30B, Super 120B, Ultra 550B | 20 requests/minute, 50/day without a qualifying credit purchase. Chalk needs two calls, sometimes three, per problem. Not enough to promise unrestricted hackathon use. |
| Hugging Face Inference Providers | Provider-dependent open weights | $0.10 monthly free credit; unsuitable as the main backend. |
| Cloudflare Workers AI | Model-dependent catalog | 10,000 neurons/day free; neurons are model-dependent, not unrestricted requests. |
| NVIDIA API catalog | Existing authenticated models | Trial availability and limits are provider-controlled. No unlimited-use guarantee. |

OpenCode free Big Pickle and promotional models appeared in the catalog, but tested application calls were rejected by their runtime provider. Catalog visibility does not establish application availability.

A public OpenRouter catalog check also returned these free text-output entries: SpaceBunny Alpha; Ling 3 Flash Sante/Fin; Dots 3 Note Preview; LFM2.5 2.6B; Nemotron3.5 Lightning; Inkling/Inkling Small; Laguna S2.1/XS2.1; North Mini Code; and OpenRouter Free. Promotional availability changes. Music generation and content-safety models are not physics solvers. These catalog entries were researched, not benchmarked.

## Primary sources

- [OpenCode Go allowances](https://opencode.ai/docs/go/)
- [OpenCode Zen promotions](https://opencode.ai/docs/zen/)
- [Ollama Qwen3.5](https://ollama.com/library/qwen3.5)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)
- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits)
- [Hugging Face pricing](https://huggingface.co/docs/inference-providers/pricing)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

Timing results are individual tests, not guarantees. Local inference removes API quotas but does not guarantee accurate advanced physics. No free hosted service can be promised never to exhaust its allowance.
