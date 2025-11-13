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

// ✔ DOĞRU MODEL — Native Audio Live API modeli
const MODEL = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.5-flash-exp-native-audio`;

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

// EXPRESS
const app = express();
app.get("/", (req, res) => res.send("Vertex Gemini Live Native Audio Proxy OK"));

const server = app.listen(PORT, () =>
  console.log("Listening on port", PORT)
);

// WS server
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("Unity connected → creating LiveSession");

  try {
    const token = await getAccessToken();

    // ✔ DOĞRU LiveSession endpoint
    const createUrl =
      `https://${LOCATION}-aiplatform.googleapis.com/v1beta/${MODEL}/liveSessions`;

    const createBody = {
      model: MODEL,
      generationConfig: {
        responseModalities: ["AUDIO"],
        audioConfig: {
          voiceConfig: { voiceName: "charlie" }
        }
      }
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
    } catch (err) {
      console.error("❌ Google returned HTML:");
      console.error(raw);
      unityWS.send(JSON.stringify({ error: "API error" }));
      return;
    }

    const sessionName = session.session?.name || session.name;
    console.log("LiveSession:", sessionName);

    // CONNECT WS
    const vertexWS = new WS(
      `wss://${LOCATION}-aiplatform.googleapis.com/v1beta/${sessionName}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    vertexWS.on("open", () => {
      console.log("Vertex LiveSession WS connected");
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
          unityWS.send(JSON.stringify({
            type: "audio_chunk",
            data: parsed.serverContent
          }));
        }
      } catch (_) {}
    });

  } catch (e) {
    console.error("Fatal:", e);
  }
});
