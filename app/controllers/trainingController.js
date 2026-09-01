/**
 * Model Training Controller
 * Handles training-related requests and operations
 */

const modelTrainingService = require("../services/modelTrainingService");

class ModelTrainingController {
  /**
   * Initialize a training session
   * POST /api/training/initialize
   */
  async initializeSession(req, res) {
    try {
      console.log("📚 [TrainingController] Initializing training session");

      const { modelName, trainingType, epochCount, learningRate, batchSize } =
        req.body;

      if (!modelName) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Model name is required",
          code: "MISSING_MODEL_NAME",
        });
      }

      const session = await modelTrainingService.initializeTrainingSession({
        modelName,
        trainingType,
        epochCount,
        learningRate,
        batchSize,
      });

      return res.status(200).json(session);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Training Initialization Failed",
        message: error.message,
        code: "TRAINING_INIT_FAILED",
      });
    }
  }

  /**
   * Upload training data
   * POST /api/training/upload-data
   */
  async uploadData(req, res) {
    try {
      console.log("📤 [TrainingController] Uploading training data");

      const { sessionId, dataType, records, source } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Session ID is required",
          code: "MISSING_SESSION_ID",
        });
      }

      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Training records array is required and must not be empty",
          code: "INVALID_RECORDS",
        });
      }

      const uploadResult = await modelTrainingService.uploadTrainingData({
        sessionId,
        dataType,
        records,
        source,
      });

      return res.status(200).json(uploadResult);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Data Upload Failed",
        message: error.message,
        code: "UPLOAD_FAILED",
      });
    }
  }

  /**
   * Start fine-tuning job
   * POST /api/training/start-fine-tune
   */
  async startFineTuning(req, res) {
    try {
      console.log("🔧 [TrainingController] Starting fine-tuning job");

      const {
        sessionId,
        modelName,
        uploadId,
        epochCount,
        learningRate,
        batchSize,
        validationSplit,
      } = req.body;

      if (!sessionId || !uploadId) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Session ID and Upload ID are required",
          code: "MISSING_REQUIRED_PARAMS",
        });
      }

      const jobResult = await modelTrainingService.startFineTuning({
        sessionId,
        modelName,
        uploadId,
        epochCount,
        learningRate,
        batchSize,
        validationSplit,
      });

      return res.status(200).json(jobResult);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Fine-Tuning Failed",
        message: error.message,
        code: "FINE_TUNING_FAILED",
      });
    }
  }

  /**
   * Get training job status
   * GET /api/training/status/:jobId
   */
  async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;

      console.log("🔍 [TrainingController] Fetching job status:", jobId);

      if (!jobId) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Job ID is required",
          code: "MISSING_JOB_ID",
        });
      }

      const status = await modelTrainingService.getJobStatus(jobId);

      return res.status(200).json(status);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Status Fetch Failed",
        message: error.message,
        code: "STATUS_FETCH_FAILED",
      });
    }
  }

  /**
   * Get evaluation metrics
   * GET /api/training/metrics/:jobId
   */
  async getMetrics(req, res) {
    try {
      const { jobId } = req.params;

      console.log("📊 [TrainingController] Fetching evaluation metrics:", jobId);

      if (!jobId) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Job ID is required",
          code: "MISSING_JOB_ID",
        });
      }

      const metrics = await modelTrainingService.getEvaluationMetrics(jobId);

      return res.status(200).json(metrics);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Metrics Fetch Failed",
        message: error.message,
        code: "METRICS_FETCH_FAILED",
      });
    }
  }

  /**
   * Deploy trained model
   * POST /api/training/deploy
   */
  async deployModel(req, res) {
    try {
      console.log("🚀 [TrainingController] Deploying model");

      const { jobId, modelName, environment, version, rolloutPercentage } =
        req.body;

      if (!jobId || !modelName) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Job ID and Model Name are required",
          code: "MISSING_DEPLOYMENT_PARAMS",
        });
      }

      const deploymentResult = await modelTrainingService.deployModel({
        jobId,
        modelName,
        environment,
        version,
        rolloutPercentage,
      });

      return res.status(200).json(deploymentResult);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Deployment Failed",
        message: error.message,
        code: "DEPLOYMENT_FAILED",
      });
    }
  }

  /**
   * Submit feedback for model improvement
   * POST /api/training/feedback
   */
  async submitFeedback(req, res) {
    try {
      console.log("💬 [TrainingController] Submitting feedback");

      const {
        conversationId,
        userQuery,
        modelResponse,
        feedbackType,
        rating,
        feedbackText,
        modelName,
      } = req.body;

      if (!conversationId || !userQuery || !modelResponse) {
        return res.status(400).json({
          error: "Invalid Request",
          message:
            "Conversation ID, user query, and model response are required",
          code: "MISSING_FEEDBACK_PARAMS",
        });
      }

      const feedbackResult = await modelTrainingService.submitFeedback({
        conversationId,
        userQuery,
        modelResponse,
        feedbackType,
        rating,
        feedbackText,
        modelName,
      });

      return res.status(200).json(feedbackResult);
    } catch (error) {
      console.error("❌ [TrainingController] Error:", error);
      return res.status(500).json({
        error: "Feedback Submission Failed",
        message: error.message,
        code: "FEEDBACK_FAILED",
      });
    }
  }
}

module.exports = new ModelTrainingController();
