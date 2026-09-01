/**
 * CortexRequest Model
 * Handles Cortex API request validation and ID generation
 */
const crypto = require("crypto");

class CortexRequest {
  /**
   * Constructor
   * @param {Object} data - Request data
   * @param {string} data.question - The question/prompt to send to Cortex
   * @param {string} [data.modelName="ibu-fahad-custom-v2-canada-2"] - Cortex model name
   * @param {boolean} [data.streaming=true] - Whether to stream response
   * @param {boolean} [data.no_summary=false] - Whether to skip summary
   * @param {number} [data.workflow_timeout=1800] - Workflow timeout in seconds
   * @param {boolean} [data.background_job=false] - Whether to run as background job
   * @param {string} [data.systemPrompt] - System prompt to prepend to the question
   */
  constructor(data = {}) {
    this.question = data.question || "";
    this.modelName = data.modelName || "ibu-fahad-custom-v2-canada";
    this.streaming = data.streaming !== undefined ? data.streaming : false;
    this.no_summary = data.no_summary || false;
    this.workflow_timeout = data.workflow_timeout || 1800;
    this.background_job = data.background_job || false;
    this.systemPrompt = data.systemPrompt || null;

    // Auto-generate session ID
    this.sessionId = `cortex-session-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;
  }

  /**
   * Validate request
   * @returns {boolean} - True if valid
   */
  isValid() {
    return this.question && this.question.trim().length > 0;
  }

  /**
   * Get Cortex API options object
   * @returns {Object} - Options for cortexService.askModel()
   */
  getOptions() {
    return {
      stream: this.streaming,
      no_summary: this.no_summary,
      workflow_timeout: this.workflow_timeout,
      background_job: this.background_job,
      systemPrompt: this.systemPrompt,
    };
  }

  /**
   * Serialize to JSON
   * @returns {Object} - JSON representation
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      question: this.question,
      modelName: this.modelName,
      streaming: this.streaming,
      no_summary: this.no_summary,
      workflow_timeout: this.workflow_timeout,
      background_job: this.background_job,
      systemPrompt: this.systemPrompt ? "[ENABLED]" : null,
    };
  }
}

module.exports = CortexRequest;
