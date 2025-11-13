// server_voice_realtime.js
// ---------------------------------------------------------------
// UNITY → Audio(WAV/Base64) → STT → Gemini → TTS → UNITY (Audio)
// Realtime Voice Interaction (Most Stable & Fastest Path)
// ---------------------------------------------------------------

import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";

// === CONFIG ===
const PORT = process.env.PORT || 10000;
const PROJECT_ID = "gemini-live-477912";
const LOCATION = "us-central1";

// Gemini model (Realtime, FAST)
const GEMINI_MODEL = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-1.5-flash`;

// === GOOGLE AUTH ===
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  fs.writeFileSync("key.json", process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

const auth = new GoogleAuth({
  keyFile: "key.json",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken() {
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return t.token;
}

// === EXPRESS SERVER ===
const app = express();
app.get("/", (_, res) => res.send("Voice Realtime Proxy OK"));
const server = app.listen(PORT, () =>
  console.log("Listening on port", PORT)
);

// === WEBSOCKET SERVER ===
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("🔵 Unity Connected");

  unityWS.on("message", async (msg) => {
    let dataRaw = msg.toString();
    console.log("RAW FROM UNITY:", dataRaw.slice(0, 200));

    let data;
    try {
      data = JSON.parse(dataRaw);
    } catch (e) {
      console.error("JSON Parse Error from Unity:", e.message);
      return;
    }

    if (data.type !== "audio") {
      console.log("Ignoring non-audio WS message");
      return;
    }

    try {
      console.log("🎤 Audio received, running STT...");

      // === SPEECH TO TEXT ===
      const transcript = await speechToText(data.audioBase64);

      console.log("🗣️ USER SAID:", transcript);
      unityWS.send(JSON.stringify({ type: "transcript", text: transcript }));

      if (!transcript) return;

      // === GEMINI REPLY ===
      console.log("🤖 Gemini generating reply...");
      const replyText = await geminiGenerate(transcript);
      console.log("🤖 Gemini:", replyText);

      unityWS.send(JSON.stringify({ type: "ai_text", text: replyText }));

      // === TTS ===
      console.log("🔊 Converting reply to speech...");
      const audioBase64 = await textToSpeech(replyText);

      unityWS.send(
        JSON.stringify({
          type: "audio_output",
          audioBase64: audioBase64
        })
      );
      console.log("🔥 Reply sent to Unity");

    } catch (err) {
      console.error("❌ PIPELINE ERROR:", err.message);
      unityWS.send(JSON.stringify({ error: err.message }));
    }
  });
});


// ------------------------------------------------------------
//  SPEECH TO TEXT (Google Speech API)
// ------------------------------------------------------------
async function speechToText(base64Audio) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing.");

  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;

  const body = {
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      languageCode: "en-US",
    },
    audio: { content: base64Audio },
  };

  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

  const json = await res.json();
  return json.results?.[0]?.alternatives?.[0]?.transcript || "";
}


// ------------------------------------------------------------
//  GEMINI TEXT REPLY (GenerateContent)
// ------------------------------------------------------------
async function geminiGenerate(userText) {
  const token = await getAccessToken();

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: userText }]
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "I could not understand.";
}


// ------------------------------------------------------------
//  TEXT TO SPEECH (Google TTS API)
// ------------------------------------------------------------
async function textToSpeech(text) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing.");

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

  const body = {
    input: { text: text },
    voice: { languageCode: "en-US", name: "en-US-Journey-F" },
    audioConfig: { audioEncoding: "LINEAR16" }
  };

  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

  const json = await res.json();
  return json.audioContent;
}
