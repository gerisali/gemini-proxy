// server_vertex.js
// -----------------------------------------------------
// Gemini 2.5 Flash Native Audio Preview 09-2025
// Vertex AI Live API — Correct API Paths (NO publishers/google)
// Unity <-> Render Proxy <-> Vertex Live WebSocket
// -----------------------------------------------------

import express from "express";
import { WebSocketServer } from "ws";
import { WebSocket as WS } from "ws";
import fetch from "node-fetch";
import fs from "fs";
import { GoogleAuth } from "google-auth-library";

// === Config ===
const PORT = process.env.PORT || 10000; // Render usually exposes 10000
const PROJECT_ID = "gemini-live-477912";
const LOCATION = "us-central1";

// 🔥 DOĞRU MODEL PATH (publisher yok!)
const MODEL = `projects/${PROJECT_ID}/locations/${LOCATION}/models/gemini-2.5-flash-native-audio-preview-09-2025`;

// === Key setup ===
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  fs.writeFileSync("key.json", process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

const auth = new GoogleAuth({
  keyFile: "key.json",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

// === Get Access Token ===
async function getAccessToken() {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// === Express root ===
const app = express();
app.get("/", (req, res) =>
  res.send("Vertex Gemini Live Proxy ACTIVE (Native Audio Preview 09-2025)")
);

const server = app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

// === WebSocket Server (Unity <-> Proxy) ===
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("Unity connected → creating LiveSession");

  try {
    const token = await getAccessToken();

    // 🔥 DOĞRU LiveSession Create URL (publisher yok!)
    const createUrl =
      `https://${LOCATION}-aiplatform.googleapis.com/v1beta/${MODEL}/liveSessions`;

    const createReqBody = {
      model: MODEL,
      generationConfig: {
        responseModalities: ["AUDIO"],
        audioConfig: {
          voiceConfig: { voiceName: "charlie" }
        }
      }
    };

    // === CREATE LiveSession ===
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createReqBody),
    });

    // If Google returns HTML due to invalid path, catch here:
    const raw = await createRes.text();
    let session;
    try {
      session = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Google returned HTML instead of JSON:");
      console.error(raw);
      unityWS.send(JSON.stringify({ error: "Invalid model path or endpoint" }));
      return;
    }

    const sessionName = session?.session?.name || session?.name;
    console.log("LiveSession created:", sessionName);

    // === Connect to Vertex WS ===
    const vertexWS = new WS(
      `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/${sessionName}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    vertexWS.on("open", () => {
      console.log("Vertex LiveSession WS connected");
    });

    // === Unity → Vertex ===
    unityWS.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        if (data.type === "text") {
          vertexWS.send(
            JSON.stringify({
              clientInput: {
                turns: [
                  { role: "user", parts: [{ text: data.text }] }
                ]
              }
            })
          );
        }

        if (data.type === "audio") {
          vertexWS.send(
            JSON.stringify({
              clientInput: {
                turns: [
                  {
                    role: "user",
                    parts: [
                      {
                        inlineData: {
                          mimeType: "audio/wav",
                          data: data.audioBase64
                        }
                      }
                    ]
                  }
                ]
              }
            })
          );
        }
      } catch (err) {
        console.error("Unity->Proxy parse error:", err);
      }
    });

    // === Vertex → Unity ===
    vertexWS.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        const serverContent = parsed.serverContent;

        if (serverContent?.modalities?.includes("AUDIO")) {
          unityWS.send(
            JSON.stringify({
              type: "audio_chunk",
              data: serverContent
            })
          );
        }
      } catch (err) {
        console.error("Vertex->Proxy parse error:", err);
      }
    });

    vertexWS.on("close", () => {
      console.log("Vertex WS closed");
      unityWS.send(JSON.stringify({ type: "end" }));
    });

    vertexWS.on("error", (err) => {
      console.error("Vertex WS error:", err.message);
      unityWS.send(JSON.stringify({ error: err.message }));
    });

  } catch (error) {
    console.error("❌ Proxy internal error:", error.message);
    unityWS.send(JSON.stringify({ error: error.message }));
  }
});
