// server_voice_realtime.js
// ---------------------------------------------------------------
// UNITY → PCM(AUDIO) → WAV → STT → Gemini → TTS → UNITY(AUDIO)
// Full realtime voice proxy (fastest & most stable)
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

// Real-time Gemini text model (fast, reliable)
const GEMINI_MODEL =
  `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-1.5-flash`;

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
app.get("/", (_, res) => res.send("Voice Realtime Proxy Running"));
const server = app.listen(PORT, () =>
  console.log("Listening on port", PORT)
);

// === PCM → WAV CONVERTER ===
function pcm16ToWav(base64Pcm, sampleRate = 16000) {
  const pcm = Buffer.from(base64Pcm, "base64");
  const header = Buffer.alloc(44);

  // "RIFF"
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);

  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);

  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString("base64");
}

// === WEBSOCKET SERVER ===
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("🔵 Unity Connected");

  unityWS.on("message", async (msg) => {
    const raw = msg.toString();
    console.log("🔥 RAW FROM UNITY:", raw.slice(0, 200));

    // Parse JSON
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("❌ JSON Parse Error:", e.message);
      return;
    }

    if (data.type !== "audio") {
      console.log("↪️ Non-audio WS message ignored");
      return;
    }

    console.log("🎤 Audio message RECEIVED from Unity");

    try {
      // === PCM → WAV ===
      console.log("🔧 Converting PCM → WAV (for STT)...");
      const wavBase64 = pcm16ToWav(data.audioBase64, 16000);

      // === STT ===
      console.log("🗣️ Running Speech-to-Text...");
      const transcript = await speechToText(wavBase64);

      console.log("🗣️ USER SAID:", transcript);
      unityWS.send(JSON.stringify({ type: "transcript", text: transcript }));

      if (!transcript || transcript.trim().length === 0) {
        console.log("⚠️ Empty transcript → stopping pipeline");
        return;
      }

      // === GEMINI ===
      console.log("🤖 Gemini generating reply...");
      const aiText = await geminiGenerate(transcript);

      console.log("🤖 Gemini:", aiText);
      unityWS.send(JSON.stringify({ type: "ai_text", text: aiText }));

      // === TTS ===
      console.log("🔊 TTS converting reply to speech...");
      const audioBase64 = await textToSpeech(aiText);

      console.log("🔥 Sending audio back to Unity");
      unityWS.send(
        JSON.stringify({
          type: "audio_output",
          audioBase64: audioBase64,
        })
      );

    } catch (err) {
      console.error("❌ Pipeline Error:", err.message);
      unityWS.send(JSON.stringify({ error: err.message }));
    }
  });
});

// ------------------------------------------------------------
//  SPEECH TO TEXT (Google Speech API)
// ------------------------------------------------------------
async function speechToText(wavBase64) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;

  const body = {
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      languageCode: "en-US",
    },
    audio: { content: wavBase64 },
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
//  GEMINI TEXT GENERATION
// ------------------------------------------------------------
async function geminiGenerate(userText) {
  const token = await getAccessToken();

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
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
  return (
    json.candidates?.[0]?.content?.parts?.[0]?.text ||
    "I'm not sure how to respond."
  );
}

// ------------------------------------------------------------
//  TEXT TO SPEECH (TTS)
// ------------------------------------------------------------
async function textToSpeech(text) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

  const body = {
    input: { text },
    voice: { languageCode: "en-US", name: "en-US-Journey-F" },
    audioConfig: { audioEncoding: "LINEAR16" },
  };

  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

  const json = await res.json();
  return json.audioContent;
}
