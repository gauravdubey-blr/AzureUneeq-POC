/**
 * LLMResponse Model
 * Represents an LLM response with metadata
 */
class LLMResponse {
  constructor(data = {}) {
    this.chatId = data.chatId || this.generateChatId();
    this.chatMessageId = data.chatMessageId || Date.now().toString();
    this.question = data.question || '';
    this.sessionId = data.sessionId || '';
    this.response = data.response || '';
    this.streaming = data.streaming !== undefined ? data.streaming : false;
    this.model = data.model || '';
    this.timestamp = data.timestamp || new Date().toISOString();
    this.usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this.error = data.error || null;
  }

  generateChatId() {
    return `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  addUsage(usage) {
    this.usage = usage;
    return this;
  }

  addError(error) {
    this.error = error;
    return this;
  }

  toJSON() {
    return {
      chatId: this.chatId,
      chatMessageId: this.chatMessageId,
      question: this.question,
      sessionId: this.sessionId,
      response: this.response,
      streaming: this.streaming,
      model: this.model,
      timestamp: this.timestamp,
      usage: this.usage,
      error: this.error
    };
  }

  toSSE(event, data) {
    return `data: ${JSON.stringify({ event, data })}\n\n`;
  }
}

module.exports = LLMResponse;
