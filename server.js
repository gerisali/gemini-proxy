import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;
const app = express();

// Basit WebSocket sunucusu
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  console.log("🟢 Unity connected to proxy.");

  ws.on("message", async (message) => {
    console.log("📩 Data from Unity:", message.toString());

    // Şimdilik sadece test logu basıyoruz
    ws.send(JSON.stringify({ type: "ack", message: "Proxy alive and ready" }));
  });
});

const server = app.listen(PORT, () =>
  console.log(`🚀 Proxy running on port ${PORT}`)
);

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
