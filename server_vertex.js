// server_vertex.js
import fs from "fs";
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  fs.writeFileSync("key.json", process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}
import express from "express";
import { WebSocketServer } from "ws";
import { WebSocket as WS } from "ws";
import fetch from "node-fetch";
import fs from "fs";
import { GoogleAuth } from "google-auth-library";

const PORT = process.env.PORT || 8080;
const PROJECT_ID = "gemini-live-477912"; // senin Project ID
const LOCATION = "us-central1";
const MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";

// ---------------- AUTH -----------------
const auth = new GoogleAuth({
  keyFile: "key.json", // service account key dosyan
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// --------------- EXPRESS ---------------
const app = express();
app.get("/", (req, res) => res.send("✅ Vertex Gemini Live Proxy aktif!"));

const server = app.listen(PORT, () =>
  console.log(`🚀 Vertex Proxy dinliyor port ${PORT}`)
);

// --------------- WEBSOCKET ---------------
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("🟢 Unity bağlandı (Vertex mode)");

  unityWS.on("message", async (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.type === "audio" || data.type === "text") {
      await connectToGeminiVertex(data, unityWS);
    }
  });

  unityWS.on("close", () => console.log("🔴 Unity bağlantısı kapandı"));
});

// --------------- GEMINI LIVE HANDLER ---------------
async function connectToGeminiVertex(data, unityWS) {
  try {
    const accessToken = await getAccessToken();

    const url = `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${LOCATION}/endpoints/openapi-endpoint:streamGenerateContent`;

    console.log("🌐 Vertex Live API bağlantısı açılıyor...");

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const geminiWS = new WS(url, { headers });

    geminiWS.on("open", () => {
      console.log("✅ Vertex Gemini Live bağlandı!");

      const payload = {
        model: MODEL,
        contents: [
          {
            role: "user",
            parts:
              data.type === "text"
                ? [{ text: data.text }]
                : [
                    {
                      inline_data: {
                        mime_type: "audio/wav",
                        data: data.audioBase64,
                      },
                    },
                  ],
          },
        ],
        generation_config: {
          response_modalities: ["AUDIO"],
          audio_config: {
            voice_config: { voice_name: "charlie" },
          },
        },
      };

      geminiWS.send(JSON.stringify(payload));
    });

    geminiWS.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.candidates) {
          console.log("🔊 Ses chunk geldi (Vertex)");
          unityWS.send(JSON.stringify({ type: "audio_chunk", data: parsed }));
        }
      } catch (err) {
        console.error("Parse error:", err.message);
      }
    });

    geminiWS.on("close", () => {
      console.log("🔴 Vertex bağlantısı kapandı");
      unityWS.send(JSON.stringify({ type: "end" }));
    });

    geminiWS.on("error", (err) => {
      console.error("❌ Vertex hata:", err.message);
      unityWS.send(JSON.stringify({ error: err.message }));
    });
  } catch (error) {
    console.error("Token veya bağlantı hatası:", error.message);
    unityWS.send(JSON.stringify({ error: error.message }));
  }
}

