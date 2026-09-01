const express = require("express");
const sdkService = require("../services/sdkService");
const azureAuthService = require("../services/azureAuthService");

const router = express.Router();

/**
 * POST /sdk/text-to-speech
 * Convert text to speech using Azure Speech SDK
 */
router.post("/text-to-speech", async (req, res) => {
  try {
    const { text, voice } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Acquire token from Azure Auth Service
    const token = await azureAuthService.getAccessToken();
    if (!token) {
      return res.status(500).json({ error: "Failed to acquire Azure access token" });
    }

    const audioBuffer = await sdkService.textToSpeechSDK(text, token, voice);

    res.setHeader("Content-Type", "audio/wav");
    res.send(audioBuffer);
  } catch (error) {
    console.error("SDK TTS Error:", error);
    res.status(500).json({ error: "TTS failed", message: error.message });
  }
});
router.get("/test", (req, res) => {
  res.status(200).json({
    status: "SDK test successful",
    timestamp: new Date().toISOString(),
    service: "Azure Speech SDK",
    region: process.env.SPEECH_REGION || "eastus2",
  });
});

module.exports = router;
