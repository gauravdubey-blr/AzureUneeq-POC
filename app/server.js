const express = require("express");

// Import modular components
const { config, validateConfig } = require("./config/config");
const azureAuthService = require("./services/azureAuthService");
const apiSpeechRoutes = require("./routes/speechRoutes");
const apiVoiceRoutes = require("./routes/voiceRoutes");
const sdkRoutes = require("./routes/sdkRoutes");
const voiceInstance = require("./config/voiceInstance");

// Import middleware
const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const PORT = config.server.port;
let authInitialized = false;

/**
 * Initialize application modules
 */
async function initializeApp() {
  try {
    // Validate configuration
    validateConfig();

    // Initialize Azure authentication
    authInitialized = await azureAuthService.initialize();

    console.log("✓ Application modules initialized successfully");
  } catch (error) {
    console.error("Failed to initialize application:", error);
    process.exit(1);
  }
}

// Middleware
app.use(express.json());
app.use(requestLogger); // Log all requests

// Routes
app.get("/", (req, res) => {
  res.status(200).json({
    name: "AzureUneeq Voice API",
    status: "ok",
    endpoints: {
      health: "/health",
      apiHealth: "/api/health",
      voiceConfig: "/api/voice/config",
      voiceTranscribe: "/api/voice/transcribe",
      voiceSpeak: "/api/voice/speak",
      voiceConverse: "/api/voice/converse",
      textToSpeech: "/api/text-to-speech",
      speechToText: "/api/speech-to-text",
      llmQuery: "/api/llm-query",
      cortex: "/api/cortex",
      sdkTextToSpeech: "/sdk/text-to-speech",
    },
    timestamp: new Date().toISOString(),
  });
});


app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    modules: {
      config: "loaded",
      auth: authInitialized ? "initialized" : "not-configured",
      tts: "available",
      voice: voiceInstance.isReady() ? "ready" : "not-configured",
    },
    // Which Azure resource voice input/output resolved to. No secrets.
    voiceInstance: voiceInstance.publicView(),
  });
});

// API routes
// Voice routes are mounted before the legacy speech routes so /api/voice/* is
// matched by the dedicated router.
app.use("/api/voice", apiVoiceRoutes);
app.use("/api", apiSpeechRoutes);
app.use("/sdk", sdkRoutes);

// Start the server
async function startServer() {
  await initializeApp();

  app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(
      `🎤 TTS API available at http://localhost:${PORT}/api/text-to-speech`,
    );
    console.log(
      `🔧 SDK TTS available at http://localhost:${PORT}/sdk/text-to-speech`,
    );
    console.log(`❤️  Health check at http://localhost:${PORT}/health`);
    console.log(`🎙️  Voice input   POST http://localhost:${PORT}/api/voice/transcribe`);
    console.log(`🔊 Voice output  POST http://localhost:${PORT}/api/voice/speak`);
    console.log(`💬 Voice turn    POST http://localhost:${PORT}/api/voice/converse`);
    console.log(`⚙️  Voice config  GET  http://localhost:${PORT}/api/voice/config`);
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Start the application
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
