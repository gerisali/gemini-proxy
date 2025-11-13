// server_vertex.js
// -----------------------------------------------------
// Gemini 2.5 Native Audio Preview (Vertex AI Live API)
// Based on GoogleCloudPlatform/generative-ai notebook
// -----------------------------------------------------

import express from "express";
import { WebSocketServer } from "ws";
import { WebSocket as WS } from "ws";
import fetch from "node-fetch";
import fs from "fs";
import { GoogleAuth } from "google-auth-library";

// === Config ===
const PORT = process.env.PORT || 8080;
const PROJECT_ID = "gemini-live-477912";
const LOCATION = "us-central1 (Iowa)";
const MODEL = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.5-flash-native-audio-preview-09-2025`;

// === Key setup ===
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  fs.writeFileSync("key.json", process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

const auth = new GoogleAuth({
  keyFile: "key.json",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// === Express setup ===
const app = express();
app.get("/", (req, res) =>
  res.send("✅ Vertex Gemini Live Proxy (Native Audio) aktif!")
);
const server = app.listen(PORT, () =>
  console.log(`🚀 Vertex Proxy dinliyor port ${PORT}`)
);

// === WebSocket: Unity <-> Proxy ===
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("🟢 Unity bağlandı (Vertex Live Mode)");

  unityWS.on("message", async (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.type === "audio" || data.type === "text") {
      await handleGeminiLiveSession(data, unityWS);
    }
  });

  unityWS.on("close", () => console.log("🔴 Unity bağlantısı kapandı"));
});

// === LiveSession handler ===
async function handleGeminiLiveSession(data, unityWS) {
  try {
    const token = await getAccessToken();

    // 1️⃣ Create LiveSession
    const sessionUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${LOCATION}/liveSessions`;
    const createBody = {
      model: MODEL,
      generationConfig: {
        responseModalities: ["AUDIO"],
        audioConfig: { voiceConfig: { voiceName: "charlie" } },
      },
    };

    const createRes = await fetch(sessionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("❌ LiveSession oluşturulamadı:", errText);
      unityWS.send(JSON.stringify({ error: errText }));
      return;
    }

    const session = await createRes.json();
    const liveUrl = session.session?.name || session.name;
    console.log("✅ LiveSession oluşturuldu:", liveUrl);

    // 2️⃣ Connect WebSocket
    const wsUrl = `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/${liveUrl}`;
    console.log("🌐 Vertex LiveSession WebSocket'e bağlanılıyor...");

    const geminiWS = new WS(wsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    geminiWS.on("open", () => {
      console.log("✅ Vertex LiveSession WS bağlandı!");

      // 3️⃣ Send initial input
      const inputData =
        data.type === "text"
          ? {
              clientInput: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: data.text }],
                  },
                ],
              },
            }
          : {
              clientInput: {
                turns: [
                  {
                    role: "user",
                    parts: [
                      {
                        inlineData: {
                          mimeType: "audio/wav",
                          data: data.audioBase64,
                        },
                      },
                    ],
                  },
                ],
              },
            };

      geminiWS.send(JSON.stringify(inputData));
      console.log("📤 Input gönderildi (Vertex Live)");
    });

    geminiWS.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.serverContent?.modalities?.includes("AUDIO")) {
          unityWS.send(
            JSON.stringify({ type: "audio_chunk", data: parsed.serverContent })
          );
        }
      } catch (err) {
        console.error("Parse error:", err.message);
      }
    });

    geminiWS.on("close", () => {
      console.log("🔴 Vertex LiveSession kapandı");
      unityWS.send(JSON.stringify({ type: "end" }));
    });

    geminiWS.on("error", (err) => {
      console.error("❌ Vertex WS hata:", err.message);
      unityWS.send(JSON.stringify({ error: err.message }));
    });
  } catch (err) {
    console.error("Token veya bağlantı hatası:", err.message);
    unityWS.send(JSON.stringify({ error: err.message }));
  }
}

