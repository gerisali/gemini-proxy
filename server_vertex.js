// server_vertex.js — Gemini 2.0 Flash EXP (WebSocket Native Audio)
// ---------------------------------------------------------------

import express from "express";
import { WebSocketServer } from "ws";
import { WebSocket as WS } from "ws";
import fetch from "node-fetch";
import fs from "fs";
import { GoogleAuth } from "google-auth-library";

// === Config ===
const PORT = process.env.PORT || 10000;
const PROJECT_ID = "gemini-live-477912";
const LOCATION = "us-central1";

// ✔ WebSocket destekli doğru model
const MODEL =
  `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp`;

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

const app = express();
app.get("/", (req, res) =>
  res.send("Vertex Gemini 2.0 Flash EXP WS Proxy OK")
);

const server = app.listen(PORT, () =>
  console.log(`Listening on port ${PORT}`)
);

const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("Unity connected → creating LiveSession");

  const token = await getAccessToken();

  // ✔ Doğru: 2.0 Flash EXP WebSocket Live API endpoint
  const createUrl =
    `https://${LOCATION}-aiplatform.googleapis.com/v1beta/${MODEL}/liveSessions`;

  const createBody = {
    model: MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      audioConfig: { voiceConfig: { voiceName: "charlie" } },
    },
  };

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });

  const raw = await createRes.text();
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    console.error("HTML ERROR:", raw);
    unityWS.send(JSON.stringify({ error: "Failed to create LiveSession" }));
    return;
  }

  const sessionName = session.session?.name || session.name;
  console.log("LiveSession:", sessionName);

  // === Vertex Live WebSocket ===
  const vertexWS = new WS(
    `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/${sessionName}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  vertexWS.on("open", () => {
    console.log("Vertex Live WS connected");
  });

  // Unity → Vertex
  unityWS.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

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
                      data: data.audioBase64,
                    },
                  },
                ],
              },
            ],
          },
        })
      );
    }
  });

  // Vertex → Unity
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
    } catch (err) {
      console.error("Parse error:", err);
    }
  });

  vertexWS.on("close", () =>
    unityWS.send(JSON.stringify({ type: "end" }))
  );

  vertexWS.on("error", (e) =>
    unityWS.send(JSON.stringify({ error: e.message }))
  );
});
