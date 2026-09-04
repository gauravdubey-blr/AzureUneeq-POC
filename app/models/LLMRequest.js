/**
 * LLMRequest Model
 * Represents an LLM query request with session context
 */
class LLMRequest {
  constructor(data = {}) {
    this.question = data.question || "";
    this.streaming = data.streaming !== undefined ? data.streaming : true;
    this.sessionId = data.overrideConfig?.sessionId || this.generateSessionId();
    this.timestamp = new Date().toISOString();
    this.model =
      data.model ||
      process.env.OGV_LLM_DEPLOYMENT ||
      process.env.CORTEX_MODEL_DEPLOYMENT ||
      "gpt-4.1";
    this.temperature = data.temperature !== undefined ? data.temperature : 0.7;
    this.maxTokens = data.maxTokens || 2000;
  }

  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  isValid() {
    return this.question && this.question.trim().length > 0;
  }

  toJSON() {
    return {
      question: this.question,
      streaming: this.streaming,
      sessionId: this.sessionId,
      timestamp: this.timestamp,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    };
  }
}

module.exports = LLMRequest;
