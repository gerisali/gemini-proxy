// server_voice_realtime.js
// ------------------------------------------------------------
// Unity → Audio (WAV) → Google STT → Gemini Realtime → Google TTS → Unity
// ------------------------------------------------------------

import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import fetch from "node-fetch";
import { GoogleAuth } from "google-auth-library";
import { WebSocket as WS } from "ws";

// === CONFIG ===
const PORT = process.env.PORT || 10000;
const PROJECT_ID = "gemini-live-477912";
const LOCATION = "us-central1";
const GEMINI_MODEL = "models/gemini-1.5-flash"; // Realtime model

// === GOOGLE AUTH ===
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  fs.writeFileSync("key.json", process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
}

const auth = new GoogleAuth({
  keyFile: "key.json",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getToken() {
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return t.token;
}

// === BASIC SERVER ===
const app = express();
app.get("/", (_, res) => res.send("Realtime Voice Proxy Running"));
const server = app.listen(PORT, () => console.log("Listening on", PORT));

// === WEBSOCKET SERVER ===
const wss = new WebSocketServer({ server });

wss.on("connection", async (unityWS) => {
  console.log("🔵 Unity Connected");

  async function stt(base64) {
    const url = `https://speech.googleapis.com/v1/speech:recognize`;
    const token = await getToken();

    const body = {
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: "en-US",
      },
      audio: {
        content: base64,
      },
    };

    const res = await fetch(url + `?key=${process.env.GOOGLE_API_KEY}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    const json = await res.json();
    return json.results?.[0]?.alternatives?.[0]?.transcript || "";
  }

  async function gemini(text) {
    const token = await getToken();

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1beta/${GEMINI_MODEL}:generateContent`;

    const body = {
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 128 },
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
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async function tts(text) {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_API_KEY}`;

    const body = {
      input: { text },
      voice: { languageCode: "en-US", name: "en-US-Studio-M" },
      audioConfig: { audioEncoding: "LINEAR16" },
    };

    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    const json = await res.json();
    return json.audioContent; // base64 wav
  }

  // === UNITY → AUDIO INPUT ===
  unityWS.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type !== "audio") return;

      console.log("🎤 Received mic audio from Unity");

      // 1) STT
      const userText = await stt(data.audioBase64);
      console.log("🗣️ User said:", userText);

      // Send interim transcription (optional)
      unityWS.send(JSON.stringify({ type: "transcript", text: userText }));

      if (!userText) return;

      // 2) Gemini Realtime
      const aiText = await gemini(userText);
      console.log("🤖 Gemini:", aiText);

      // Send text (optional)
      unityWS.send(JSON.stringify({ type: "text_response", text: aiText }));

      // 3) TTS
      const audioB64 = await tts(aiText);

      console.log("🔊 Sending audio response to Unity");

      unityWS.send(
        JSON.stringify({
          type: "audio_output",
          audioBase64: audioB64,
        })
      );
    } catch (e) {
      console.error("❌ ERROR:", e);
    }
  });
});
