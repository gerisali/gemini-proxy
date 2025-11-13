// server_vertex.js (FIXED)
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
const LOCATION = "us-central1";
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

// === Express ===
const app = express();
app.get("/", (req, res) =>
  res.send("Vertex Gemini Live Proxy ACTIVE")
);

const server = app.listen(PORT, () =>
  console.log("Listening on port", PORT)
);

// === WebSocket (Unity <-> Proxy) ===
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("Unity connected → creating LiveSession");

  // Create ONE LiveSession per Unity connection
  const token = await getAccessToken();

  const createUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.5-flash-native-audio-preview-09-2025/liveSessions`;
  
  const createBody = {
    model: MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      audioConfig: { voiceConfig: { voiceName: "charlie" } },
    },
  };

  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });

  const session = await res.json();
  const sessionName = session.session?.name || session.name;

  console.log("LiveSession:", sessionName);

  // CONNECT TO VERTEX WS  
  const vertexWS = new WS(
    `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/${sessionName}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // Forward messages Unity → Vertex
  unityWS.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.type === "text") {
      vertexWS.send(
        JSON.stringify({
          clientInput: {
            turns: [{ role: "user", parts: [{ text: data.text }] }],
          },
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
                parts: [{
                  inlineData: {
                    mimeType: "audio/wav",
                    data: data.audioBase64,
                  },
                }],
              },
            ],
          },
        })
      );
    }
  });

  // Forward messages Vertex → Unity
  vertexWS.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());

      if (parsed.serverContent?.modalities?.includes("AUDIO")) {
        unityWS.send(
          JSON.stringify({
            type: "audio_chunk",
            data: parsed.serverContent,
          })
        );
      }
    } catch (e) {
      console.log("PARSE ERROR:", e.message);
    }
  });

  vertexWS.on("close", () => unityWS.send(JSON.stringify({ type: "end" })));
  vertexWS.on("error", (e) => unityWS.send(JSON.stringify({ error: e.message })));
});
