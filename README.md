# gemini-proxy

A small WebSocket voice proxy that lets a Unity (XR) application talk to Gemini by voice.
Unity sends recorded microphone audio; the proxy transcribes it, asks Gemini on Vertex AI for
a reply, turns the reply into speech and sends the audio back.

```
Unity ──audio──▶ proxy ──▶ Speech-to-Text ──▶ Gemini (Vertex AI) ──▶ Text-to-Speech ──▶ Unity
```

Keeping API keys and service-account credentials on the proxy means they are never built into
the Unity app or the headset.

Part of my research on [voice-native LLM agents in XR](https://github.com/gerisali/gerisali/blob/main/projects/voice-llm-agents-xr.md).
This is a research prototype, not production software.

## How it works
1. Unity opens a WebSocket connection to the proxy and sends one message per utterance:
   16 kHz, 16-bit mono PCM, base64-encoded.
2. The proxy wraps the PCM in a WAV header and sends it to Google Cloud Speech-to-Text.
3. The transcript goes to Gemini through the Vertex AI `generateContent` endpoint.
4. The reply is synthesised with Google Cloud Text-to-Speech (LINEAR16) and returned to Unity.

## Message format

Unity → proxy

```json
{ "type": "audio", "audioBase64": "<16 kHz 16-bit mono PCM, base64>" }
```

Proxy → Unity, in this order:

```json
{ "type": "transcript",   "text": "what the user said" }
{ "type": "ai_text",      "text": "Gemini's reply" }
{ "type": "audio_output", "audioBase64": "<LINEAR16 WAV, base64>" }
```

On failure the proxy sends `{ "error": "<message>" }`. If the transcript is empty, the
pipeline stops after the `transcript` message.

## Requirements
- Node.js 18 or later
- A Google Cloud project with Vertex AI, Speech-to-Text and Text-to-Speech enabled
- A service account with Vertex AI access (for Gemini)
- An API key allowed to call Speech-to-Text and Text-to-Speech

## Setup

```bash
npm install
cp .env.example .env   # fill in your values
```

| Variable | Required | Description |
|---|---|---|
| `GCP_PROJECT_ID` | yes | Google Cloud project ID |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | yes | Full service-account JSON; written to `key.json` at start-up |
| `GOOGLE_API_KEY` | yes | API key for Speech-to-Text and Text-to-Speech |
| `GCP_LOCATION` | no | Vertex AI region or `global` (default `us-central1`) |
| `GEMINI_MODEL` | no | Gemini model ID (default `gemini-3.8-flash`) |
| `LANGUAGE_CODE` | no | Speech language (default `en-US`) |
| `TTS_VOICE` | no | Text-to-Speech voice (default `en-US-Journey-F`) |
| `PORT` | no | Server port (default `10000`) |

Gemini models on Vertex AI are retired regularly. If requests fail, check Google's
[model versions and lifecycle](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
page and set `GEMINI_MODEL` (and, if needed, `GCP_LOCATION`) to a current model.

## Run

```bash
npm start
```

Node does not read `.env` files by itself: export the variables in your shell, use
`node --env-file=.env server_vertex.js` (Node 20.6+), or set them in your hosting dashboard.

## Deploy on Render
`render.yaml` describes a free Render web service. Secrets (`GCP_PROJECT_ID`,
`GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GOOGLE_API_KEY`) are entered in the Render dashboard
and are not stored in the repository. From Unity, connect to `wss://<your-service>.onrender.com`.
Free instances sleep when idle, so the first request after a pause can be slow.

## Repository layout
- `server_vertex.js`: the proxy (`npm start`)
- `experimental/server.js`: an early, unmaintained attempt at a direct Gemini Live connection, kept for reference
- `render.yaml`: Render deployment
- `.env.example`: configuration template

## Security notes
- Never commit `.env` or `key.json`; both are in `.gitignore`.
- The proxy has no authentication. Anyone who knows the URL can use your Google Cloud quota,
  so keep the URL private or add a token check before using it outside a lab setting.
- Incoming audio is logged only as the first 200 characters of each message; transcripts and
  replies are written to the server log.

## License
[MIT](LICENSE) © Ali Geriş
