// EXPERIMENTAL — early attempt at a direct Gemini Live (native audio) connection.
// Not used by `npm start` and not maintained; kept for reference only.
// The supported proxy is ../server_vertex.js.

import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import { WebSocket as WS } from "ws";

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ---- Web server setup ----
const app = express();
app.get("/", (req, res) => res.send("✅ Gemini Proxy running..."));

const server = app.listen(PORT, () =>
  console.log(`🚀 Gemini Proxy listening on port ${PORT}`)
);

// ---- WebSocket (Unity ↔ Proxy) ----
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("🟢 Unity connected to proxy");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log("📩 From Unity:", data.type);

      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", time: Date.now() }));
        return;
      }

      if (data.type === "audio" || data.type === "text") {
        await handleGeminiStream(data, ws);
      }
    } catch (err) {
      console.error("❌ Error parsing message:", err);
      ws.send(JSON.stringify({ error: err.message }));
    }
  });

  ws.on("close", () => console.log("🔴 Unity disconnected"));
});

// ---- Gemini Live Stream Handler ----
async function handleGeminiStream(data, unityWS) {
  const model = "models/gemini-2.5-flash-native-audio-preview-09-2025";
  const url = `wss://generativelanguage.googleapis.com/v1beta/${model}:streamGenerateContent?alt=sse`;

  console.log("🌐 Connecting to Gemini Live...");

  const headers = {
    "Authorization": `Bearer ${GEMINI_API_KEY}`,
    "Content-Type": "application/json",
  };

  const geminiWS = new WS(url, { headers });

  geminiWS.on("open", () => {
    console.log("✅ Gemini Live connected");

    // --- Send the initial prompt ---
    const initPayload = {
      contents: [
        {
          role: "user",
          parts: [
            data.type === "text"
              ? { text: data.text }
              : {
                  inline_data: {
                    mime_type: "audio/wav",
                    data: data.audioBase64,
                  },
                },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        audioConfig: { voiceConfig: { voiceName: "charlie" } },
      },
    };

    geminiWS.send(JSON.stringify(initPayload));
  });

  geminiWS.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.candidates) {
        console.log("🔊 Gemini responded with audio chunk");
        unityWS.send(JSON.stringify({ type: "audio_chunk", data: parsed }));
      }
    } catch (err) {
      console.error("⚠️ Gemini message parse error:", err);
    }
  });

  geminiWS.on("close", () => {
    console.log("🔴 Gemini Live closed connection");
    unityWS.send(JSON.stringify({ type: "end" }));
  });

  geminiWS.on("error", (err) => {
    console.error("❌ Gemini Live error:", err);
    unityWS.send(JSON.stringify({ error: err.message }));
  });
}
