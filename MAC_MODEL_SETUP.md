# Run Chalk's AI on a friend's Mac

Chalk and its video renderer stay on the Windows laptop. The Mac runs the model. An SSH tunnel makes the Mac's Ollama API available through a localhost port, so no public model server or API key is needed.

## On the Mac

1. Install and open [Ollama for macOS](https://ollama.com/download/mac).
2. Download the same text and vision model:

```bash
ollama pull qwen3.5:9b
ollama list
```

3. Enable System Settings → General → Sharing → Remote Login. Limit allowed users to the Mac owner's account. [Apple's instructions](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac).
4. Get the account username and Wi-Fi address:

```bash
whoami
ipconfig getifaddr en0
```

Keep Ollama's default localhost binding. Do not expose port 11434 to the public Internet. [Ollama's network configuration](https://docs.ollama.com/faq).

## On the Windows laptop

Replace MAC_USERNAME and MAC_IP with those actual values, then keep this terminal open:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:11435:127.0.0.1:11434 MAC_USERNAME@MAC_IP
```

Authenticate in the terminal; never put the password in this repository or chat. Check the Mac's available models through the tunnel:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/api/tags
```

Set these in `.env.local`, preserving other settings:

```dotenv
CHALK_SOLVER=ollama
OLLAMA_SERVER_URL=http://127.0.0.1:11435
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_VISION_MODEL=qwen3.5:9b
OLLAMA_TIMEOUT_MS=180000
```

Start Chalk with `npm run dev:local`. If it is already running, stop that server first. The startup verifies the model through the tunnel and will not silently start a replacement local server on the tunnel port.

The Mac must stay awake, connected to Wi-Fi, and running Ollama. Some venue Wi-Fi networks isolate devices; use a shared private hotspot if SSH cannot connect. Local inference has no API quota. Model accuracy and response time still need end-to-end checks on the actual Mac; this setup does not guarantee every advanced physics problem can be solved.

## Share the website on Wi-Fi

For local-model startup, set `CHALK_HOST=0.0.0.0` in `.env.local`, then run `npm run dev:local`. Alternatively, `npm run dev:lan` starts the website on all local interfaces while keeping the configured solver. Other devices open `http://WINDOWS_WIFI_IP:3000/`; localhost still works on Windows. Ollama and OpenCode stay on loopback.

If Windows Firewall blocks access, allow TCP 3000 for the Wi-Fi interface and the intended Wi-Fi address range in an administrator terminal. Do not disable the firewall. Test the address from a second device: a successful request on the hosting laptop alone does not prove inbound Wi-Fi access.

Camera capture may be unavailable on other devices over plain HTTP; photo upload still works. Browser camera access requires HTTPS or localhost.
