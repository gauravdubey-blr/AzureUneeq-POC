/**
 * REST voice API.
 *
 *   POST /api/voice/transcribe   audio → text
 *   POST /api/voice/speak        text  → audio
 *   POST /api/voice/converse     audio → text + audio (transcribe → LLM → speak)
 *   GET  /api/voice/config       which voice instance resolved (no secrets)
 *
 * All routes hit the resource resolved in config/voiceInstance.js, so repointing
 * the app moves voice input and output together.
 *
 * The older /api/text-to-speech and /api/speech-to-text routes still work and
 * now share these same services — see speechRoutes.js.
 */

const express = require("express");
const multer = require("multer");
const router = express.Router();

const azureSTTService = require("../services/azureSTTService");
const azureTTSService = require("../services/azureTTSService");
const cortexService = require("../services/cortexService");
const llmGatewayService = require("../services/llmGateway");
const { MOUNJARO_SYSTEM_PROMPT } = require("../constants/cortexPrompts");
const voiceInstance = require("../config/voiceInstance");
const {
  ALLOWED_STT_MIME,
  TTS_FORMATS,
  VoiceConfigError,
  VoiceUpstreamError,
} = voiceInstance;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: voiceInstance.voice.maxAudioBytes },
  fileFilter: (req, file, cb) => {
    const declared = String(file.mimetype || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_STT_MIME.has(declared)) {
      const err = new Error(`Unsupported audio content type '${declared}'`);
      err.statusCode = 415;
      return cb(err);
    }
    cb(null, true);
  },
});

/** Turn a service error into a JSON response, without leaking upstream detail. */
function sendVoiceError(res, error, fallbackMessage) {
  const status =
    error instanceof VoiceConfigError || error instanceof VoiceUpstreamError
      ? error.statusCode
      : error.statusCode || 500;

  if (status >= 500) {
    console.error(`[voice] ${fallbackMessage}:`, error.message);
  }

  return res.status(status).json({
    error: fallbackMessage,
    message: error.message,
    timestamp: new Date().toISOString(),
  });
}

/** Wrap multer so its errors become the right status instead of a 500. */
function uploadAudio(req, res, next) {
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "Audio too large",
        message: `Audio exceeds ${voiceInstance.voice.maxAudioBytes} bytes`,
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(err.statusCode || 400).json({
      error: "Invalid audio upload",
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  });
}

// ─── GET /api/voice/config ───────────────────────────────────────────────────
router.get("/config", (req, res) => {
  res.json({
    voiceInstance: voiceInstance.publicView(),
    endpoints: {
      transcribe: "/api/voice/transcribe",
      speak: "/api/voice/speak",
      converse: "/api/voice/converse",
    },
    legacy: {
      textToSpeech: "/api/text-to-speech",
      speechToText: "/api/speech-to-text",
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /api/voice/transcribe ──────────────────────────────────────────────
// multipart/form-data: audio=<file>, optional language / contentType
router.post("/transcribe", uploadAudio, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Audio file is required",
        message: "Attach an audio file under the form field 'audio'",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await azureSTTService.speechToText(
      req.file.buffer,
      req.body.language,
      { contentType: req.body.contentType },
    );

    return res.json({
      success: true,
      text: result.text,
      status: result.status,
      confidence: result.confidence,
      durationMs: result.durationMs,
      language: result.language,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return sendVoiceError(res, error, "Speech-to-text conversion failed");
  }
});

// ─── POST /api/voice/speak ───────────────────────────────────────────────────
// JSON: { text, voice?, format?, rate?, pitch?, style?, lang?, ssml?, encoding? }
router.post("/speak", async (req, res) => {
  try {
    const body = req.body || {};
    const { text, ssml } = body;

    if (!text && !ssml) {
      return res.status(400).json({
        error: "Text is required",
        message: "Provide 'text' or 'ssml' in the request body",
        timestamp: new Date().toISOString(),
      });
    }

    const format = String(body.format || voiceInstance.voice.defaultFormat).toLowerCase();
    if (!TTS_FORMATS[format]) {
      return res.status(400).json({
        error: "Unsupported format",
        message: `Expected one of: ${Object.keys(TTS_FORMATS).join(", ")}`,
        timestamp: new Date().toISOString(),
      });
    }

    const encoding = String(body.encoding || "binary").toLowerCase();
    if (encoding !== "binary" && encoding !== "base64") {
      return res.status(400).json({
        error: "Unsupported encoding",
        message: "encoding must be 'binary' or 'base64'",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await azureTTSService.synthesize(text, {
      voice: body.voice,
      format,
      rate: body.rate,
      pitch: body.pitch,
      style: body.style,
      lang: body.lang,
      ssml,
    });

    if (encoding === "base64") {
      return res.json({
        success: true,
        audio: result.audio.toString("base64"),
        contentType: result.contentType,
        format: result.format,
        voice: result.voice,
        bytes: result.bytes,
        timestamp: new Date().toISOString(),
      });
    }

    res.set({
      "Content-Type": result.contentType,
      "Content-Length": String(result.bytes),
      "Cache-Control": "no-store",
      "X-Voice-Name": result.voice,
      "X-Voice-Format": result.format,
    });
    return res.send(result.audio);
  } catch (error) {
    return sendVoiceError(res, error, "Text-to-speech conversion failed");
  }
});

// ─── POST /api/voice/converse ────────────────────────────────────────────────
// One full turn over REST: transcribe → model → synthesize.
// multipart/form-data: audio=<file>, optional language / voice / format /
// speak ("false" to skip synthesis) / model ("cortex" | "llm") / modelName.
router.post("/converse", uploadAudio, async (req, res) => {
  const sessionId = `voice-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Audio file is required",
        message: "Attach an audio file under the form field 'audio'",
        timestamp: new Date().toISOString(),
      });
    }

    const format = String(
      req.body.format || voiceInstance.voice.defaultFormat,
    ).toLowerCase();
    if (!TTS_FORMATS[format]) {
      return res.status(400).json({
        error: "Unsupported format",
        message: `Expected one of: ${Object.keys(TTS_FORMATS).join(", ")}`,
        timestamp: new Date().toISOString(),
      });
    }

    // 1. Voice input
    const stt = await azureSTTService.speechToText(
      req.file.buffer,
      req.body.language,
      { contentType: req.body.contentType },
    );

    if (!stt.text) {
      return res.json({
        success: true,
        sessionId,
        transcript: "",
        reply: "",
        audio: null,
        note: "No speech detected in audio",
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Model turn
    const backend = String(req.body.model || "cortex").toLowerCase();
    let reply = "";
    if (backend === "llm") {
      const out = await llmGatewayService.queryLLM(stt.text, false);
      reply = typeof out === "string" ? out : out?.text || out?.response || "";
    } else {
      const modelName = req.body.modelName || "ibu-fahad-custom-v2-saudi";
      const out = await cortexService.askModel(modelName, stt.text, {
        systemPrompt: MOUNJARO_SYSTEM_PROMPT,
        stream: false,
      });
      reply = typeof out === "string" ? out : out?.text || out?.response || "";
    }

    reply = voiceInstance.stripUneeqTags(reply);

    const payload = {
      success: true,
      sessionId,
      transcript: stt.text,
      confidence: stt.confidence,
      reply,
      backend,
      audio: null,
      contentType: null,
      voice: null,
      format,
      timestamp: new Date().toISOString(),
    };

    // 3. Voice output — optional
    const wantSpeech = String(req.body.speak ?? "true").toLowerCase() !== "false";
    if (wantSpeech && reply) {
      try {
        const tts = await azureTTSService.synthesize(reply, {
          voice: req.body.voice,
          format,
        });
        payload.audio = tts.audio.toString("base64");
        payload.contentType = tts.contentType;
        payload.voice = tts.voice;
      } catch (ttsError) {
        // The model reply is already in hand — return it rather than failing the
        // whole turn because synthesis broke.
        console.warn(
          `[voice] converse synthesis failed, returning text only: ${ttsError.message}`,
        );
        payload.synthesisError = ttsError.message;
      }
    }

    return res.json(payload);
  } catch (error) {
    return sendVoiceError(res, error, "Voice conversation turn failed");
  }
});

module.exports = router;
