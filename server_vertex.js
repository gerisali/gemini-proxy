import express from "express";
import { WebSocketServer } from "ws";
import { WebSocket as WS } from "ws";
import fetch from "node-fetch";
import fs from "fs";
import { GoogleAuth } from "google-auth-library";

const PORT = process.env.PORT || 10000;
const PROJECT_ID = "gemini-live-477912";
const LOCATION = "us-central1";

// NOTEBOOK model path:
const MODEL = `models/gemini-2.5-flash-native-audio-preview-09-2025`;

// Auth
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

const app = express();
app.get("/", (req, res) => res.send("Vertex Gemini LiveProxy OK"));
const server = app.listen(PORT, () => console.log("Listening on", PORT));

const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("Unity connected → creating LiveSession");

  const token = await getAccessToken();

  // ✔ NOTEBOOK endpoint
  const createUrl =
    `https://${LOCATION}-aiplatform.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${LOCATION}/liveSessions`;

  const createBody = {
    model: MODEL,
    generationConfig: {
      responseModalities: ["AUDIO"],
      audioConfig: { voiceConfig: { voiceName: "charlie" } }
    }
  };

  // Create session
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(createBody)
  });

  const raw = await createRes.text();
  let session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    console.error("❌ Returned HTML:", raw);
    return;
  }

  const sessionName = session.name;
  console.log("LiveSession:", sessionName);

  // WS URL from NOTEBOOK:
  const wsUrl =
    `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/${sessionName}`;

  const vertexWS = new WS(wsUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  vertexWS.on("open", () => console.log("Vertex WS connected"));

  unityWS.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.type === "audio") {
      vertexWS.send(JSON.stringify({
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
      }));
    }
  });

  vertexWS.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.serverContent?.modalities?.includes("AUDIO")) {
        unityWS.send(JSON.stringify({
          type: "audio_chunk",
          data: parsed.serverContent
        }));
      }
    } catch (_) {}
  });

});
