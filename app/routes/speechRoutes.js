const express = require("express");
const router = express.Router();
const azureTTSService = require("../services/azureTTSService");
const azureSTTService = require("../services/azureSTTService");
const llmController = require("../controllers/llmController");
const cortexController = require("../controllers/cortexController");
const trainingController = require("../controllers/trainingController");
const { MOUNJARO_SYSTEM_PROMPT } = require("../constants/cortexPrompts");

const multer = require("multer");

// Configure multer for file uploads (simple)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * Simple Text-to-Speech API endpoint
 * POST /api/text-to-speech
 * Expected payload: { "apiKey": "<api-key>", "preset": "<preset/voice>", "text": "<text to speak>" }
 */
router.post("/text-to-speech", async (req, res) => {
  try {
    console.log("TTS API: Received request body:", req.body);

    const { apiKey, preset, text } = req.body;

    // Validate required fields
    if (!apiKey) {
      return res.status(400).json({
        error: "API key is required",
        message: "Please provide apiKey in the request body",
      });
    }

    if (!preset) {
      return res.status(400).json({
        error: "Preset is required",
        message: "Please provide preset/voice in the request body",
      });
    }

    if (!text) {
      return res.status(400).json({
        error: "Text is required",
        message: "Please provide text to convert to speech",
      });
    }

    console.log("TTS API: Processing text:", text);
    console.log("TTS API: Using preset/voice:", preset);
    console.log(
      "TTS API: Using API key:",
      apiKey ? `***${apiKey.slice(-4)}` : "None",
    );

    // Use the preset as the voice parameter and WAV format for better compatibility
    const audioStream = await azureTTSService.textToSpeech(
      text,
      preset,
      apiKey,
      "riff-16khz-16bit-mono-pcm", // Use PCM format instead of WAV for better playback support
    );

    // Send audio response
    res.set({
      "Content-Type": "application/octet-stream",
      "Transfer-Encoding": "chunked",
    });

    // Handle stream errors
    audioStream.on("error", (streamError) => {
      console.error("Audio stream error:", streamError);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Audio stream failed",
          message: streamError.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle response errors
    res.on("error", (resError) => {
      console.error("Response stream error:", resError);
      audioStream.destroy();
    });

    audioStream.pipe(res);
  } catch (error) {
    console.error("TTS API Error:", error);
    res.status(500).json({
      error: "Text-to-speech conversion failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Simple Speech-to-Text API endpoint
 * POST /api/speech-to-text
 */
router.post("/speech-to-text", upload.single("audio"), async (req, res) => {

  try {
    console.log("STT API: Received request");

    if (!req.file) {
      sttLogger.error(new Error("Audio file is required"));
      return res.status(400).json({
        error: "Audio file is required",
        message: "Please upload an audio file",
      });
    }

    const { language } = req.body;

    console.log("STT API: Processing audio file:", req.file.originalname);

    const transcription = await azureSTTService.speechToText(
      req.file.buffer,
      language || "en-US",
    );

    res.json({
      success: true,
      transcription: transcription,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("STT API Error:", error);
    res.status(500).json({
      error: "Speech-to-text conversion failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Health check endpoint
 * GET /api/health
 */
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    services: {
      tts: "Azure TTS Service (Simple)",
      stt: "Azure STT Service (Simple)",
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * LLM Gateway endpoint
 * POST /api/llm-query
 *
 * Request format:
 * {
 *   "question": "The user's question",
 *   "streaming": true/false,
 *   "overrideConfig": {
 *     "sessionId": "unique-session-id"
 *   }
 * }
 *
 * Response format (streaming):
 * data: {"event":"start","data":""}
 * data: {"event":"token","data":"I'm"}
 * data: {"event":"token","data":" going"}
 * data: {"event":"metadata","data":{"chatId":"...","chatMessageId":"...","question":"...","sessionId":"..."}}
 * data: {"event":"end","data":"[DONE]"}
 *
 * Response format (non-streaming):
 * { "chatId": "...", "response": "...", "metadata": {...} }
 */
router.post("/llm-query", llmController.queryLLM.bind(llmController));

/**
 * Cortex Model Ask endpoint
 * POST /api/cortex
 *
 * Request format:
 * {
 *   "question": "Your question here",
 *   "modelName": "ibu-fahad-custom-v2-canada" (optional, defaults to ibu-fahad-custom-v2-canada),
 *   "stream": false (optional, default: false),
 *   "no_summary": false (optional, default: false),
 *   "workflow_timeout": 1800 (optional, default: 1800),
 *   "background_job": false (optional, default: false)
 * }
 *
 * Response format:
 * {
 *   "text": "The response text",
 *   "metadata": {
 *     "model": "model-name",
 *     "timestamp": "ISO timestamp",
 *     "streaming": false
 *   }
 * }
 */
// router.post("/cortex", cortexController.queryCortex.bind(cortexController));

/**
 * Cortex Model endpoint - Canada model (v1)
 * POST /api/cortex
 * Uses model: ibu-fahad-custom-v2-canada
 */
router.post("/cortex", (req, res) => {
  req.body.modelName = "ibu-fahad-custom-v2-saudi";
  req.body.systemPrompt = MOUNJARO_SYSTEM_PROMPT;
  return cortexController.queryCortex.call(cortexController, req, res);
});

/**
 * Cortex Model endpoint - Canada model v2
 * POST /api/cortex-v2
 * Uses model: ibu-fahad-custom-v2-canada-2
 */
router.post("/cortex-v2", (req, res) => {
  req.body.modelName = "ibu-fahad-custom-v2-canada-2";
  return cortexController.queryCortex.call(cortexController, req, res);
});

/**
 * Model Training Endpoints
 */

/**
 * Initialize training session
 * POST /api/training/initialize
 *
 * Request format:
 * {
 *   "modelName": "ibu-fahad-custom-v2-canada-2",
 *   "trainingType": "fine-tune",
 *   "epochCount": 3,
 *   "learningRate": 0.0001,
 *   "batchSize": 8
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "sessionId": "training-1734512345678",
 *   "modelName": "ibu-fahad-custom-v2-canada-2",
 *   "trainingType": "fine-tune",
 *   "message": "Training session initialized successfully"
 * }
 */
router.post(
  "/training/initialize",
  trainingController.initializeSession.bind(trainingController),
);

/**
 * Upload training data
 * POST /api/training/upload-data
 *
 * Request format:
 * {
 *   "sessionId": "training-1734512345678",
 *   "dataType": "conversation-pairs",
 *   "records": [
 *     {
 *       "userMessage": "What is MOUNJARO?",
 *       "assistantResponse": "MOUNJARO is a tirzepatide injection..."
 *     }
 *   ],
 *   "source": "manual"
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "uploadId": "upload-1734512345678",
 *   "sessionId": "training-1734512345678",
 *   "recordsProcessed": 50,
 *   "message": "Successfully uploaded 50 training records"
 * }
 */
router.post(
  "/training/upload-data",
  trainingController.uploadData.bind(trainingController),
);

/**
 * Start fine-tuning job
 * POST /api/training/start-fine-tune
 *
 * Request format:
 * {
 *   "sessionId": "training-1734512345678",
 *   "uploadId": "upload-1734512345678",
 *   "modelName": "ibu-fahad-custom-v2-canada-2",
 *   "epochCount": 3,
 *   "learningRate": 0.0001,
 *   "batchSize": 8,
 *   "validationSplit": 0.1
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "jobId": "job-1734512345678",
 *   "status": "queued",
 *   "estimatedDuration": "5-30 minutes",
 *   "message": "Fine-tuning job created successfully"
 * }
 */
router.post(
  "/training/start-fine-tune",
  trainingController.startFineTuning.bind(trainingController),
);

/**
 * Get training job status
 * GET /api/training/status/:jobId
 *
 * Response format:
 * {
 *   "success": true,
 *   "jobId": "job-1734512345678",
 *   "status": "in_progress",
 *   "progress": 65,
 *   "epoch": 2,
 *   "totalEpochs": 3,
 *   "currentLoss": 0.1234,
 *   "validationLoss": 0.1567,
 *   "elapsedTime": "10 minutes",
 *   "estimatedTimeRemaining": "20 minutes"
 * }
 */
router.get(
  "/training/status/:jobId",
  trainingController.getJobStatus.bind(trainingController),
);

/**
 * Get evaluation metrics
 * GET /api/training/metrics/:jobId
 *
 * Response format:
 * {
 *   "success": true,
 *   "jobId": "job-1734512345678",
 *   "trainingMetrics": {
 *     "finalTrainingLoss": 0.1234,
 *     "finalValidationLoss": 0.1567
 *   },
 *   "accuracyMetrics": {
 *     "bleuScore": 0.78,
 *     "rougeScore": 0.82
 *   },
 *   "responseQualityMetrics": {
 *     "coherenceScore": 0.85,
 *     "relevanceScore": 0.88
 *   },
 *   "comparisonToPrevious": {
 *     "improvementPercentage": "12.5",
 *     "recommandation": "ready for staging deployment"
 *   }
 * }
 */
router.get(
  "/training/metrics/:jobId",
  trainingController.getMetrics.bind(trainingController),
);

/**
 * Deploy trained model
 * POST /api/training/deploy
 *
 * Request format:
 * {
 *   "jobId": "job-1734512345678",
 *   "modelName": "ibu-fahad-custom-v2-canada-2",
 *   "environment": "staging",
 *   "version": "1.1.0",
 *   "rolloutPercentage": 100
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "deploymentId": "deploy-1734512345678",
 *   "jobId": "job-1734512345678",
 *   "status": "deploying",
 *   "environment": "staging",
 *   "estimatedTimeToLive": "5-10 minutes",
 *   "message": "Model deployment initiated successfully"
 * }
 */
router.post(
  "/training/deploy",
  trainingController.deployModel.bind(trainingController),
);

/**
 * Submit feedback for model improvement
 * POST /api/training/feedback
 *
 * Request format:
 * {
 *   "conversationId": "conv-1734512345678",
 *   "userQuery": "What is the dosage of MOUNJARO?",
 *   "modelResponse": "The starting dose is 2.5 mg...",
 *   "feedbackType": "improvement",
 *   "rating": 4,
 *   "feedbackText": "Response was helpful but could be more detailed",
 *   "modelName": "ibu-fahad-custom-v2-canada-2"
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "feedbackId": "feedback-1734512345678",
 *   "conversationId": "conv-1734512345678",
 *   "feedbackType": "improvement",
 *   "rating": 4,
 *   "message": "Feedback submitted successfully and will be used for model improvement"
 * }
 */
router.post(
  "/training/feedback",
  trainingController.submitFeedback.bind(trainingController),
);

module.exports = router;
