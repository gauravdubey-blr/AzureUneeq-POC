/**
 * Validation Utilities
 * Helper functions for request validation
 */

const validateLLMRequest = (data) => {
  const errors = [];

  if (!data.question) {
    errors.push('question is required');
  } else if (typeof data.question !== 'string') {
    errors.push('question must be a string');
  } else if (data.question.trim().length === 0) {
    errors.push('question cannot be empty');
  }

  if (data.streaming !== undefined && typeof data.streaming !== 'boolean') {
    errors.push('streaming must be a boolean');
  }

  if (data.overrideConfig) {
    if (typeof data.overrideConfig !== 'object') {
      errors.push('overrideConfig must be an object');
    }
    if (data.overrideConfig.sessionId && typeof data.overrideConfig.sessionId !== 'string') {
      errors.push('sessionId must be a string');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const validateTTSRequest = (data) => {
  const errors = [];

  if (!data.text) {
    errors.push('text is required');
  } else if (typeof data.text !== 'string') {
    errors.push('text must be a string');
  } else if (data.text.trim().length === 0) {
    errors.push('text cannot be empty');
  }

  if (!data.preset) {
    errors.push('preset is required');
  } else if (typeof data.preset !== 'string') {
    errors.push('preset must be a string');
  }

  if (!data.apiKey) {
    errors.push('apiKey is required');
  } else if (typeof data.apiKey !== 'string') {
    errors.push('apiKey must be a string');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Sanitize response text by removing markdown and special characters
 * Optimizes output for text-to-speech without losing meaning
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
const sanitizeResponse = (text) => {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let sanitized = text;

  // Remove file references with parentheses - multiple patterns to catch all variations
  // Matches: (MOUNJARO.docx), (mounjaro.docx), ( MOUNJARO.docx ), etc.
  sanitized = sanitized.replace(/\s*\(\s*[\w\-\.]+\.(?:docx|pdf|doc|xlsx|csv|txt|pptx)\s*\)\s*/gi, ' ');
  
  // Additional catch-all for file references in any context
  sanitized = sanitized.replace(/\([\w\-\s]+\.(?:docx|pdf|doc|xlsx|csv|txt|pptx)\)/gi, '');
  
  // Remove file references without parentheses mounjaro.docx, document.pdf, etc.
  sanitized = sanitized.replace(/[\w\-]+\.(?:docx|pdf|doc|xlsx|csv|txt|pptx)/gi, '');

  // Remove bold markdown (**text** or __text__)
  sanitized = sanitized.replace(/\*\*(.+?)\*\*/g, '$1');
  sanitized = sanitized.replace(/__(.+?)__/g, '$1');

  // Remove italic markdown (*text* or _text_)
  sanitized = sanitized.replace(/\*([^\*]+?)\*/g, '$1');
  sanitized = sanitized.replace(/_([^_]+?)_/g, '$1');

  // Remove strikethrough (~~text~~)
  sanitized = sanitized.replace(/~~(.+?)~~/g, '$1');

  // Remove code blocks (```code``` or `code`)
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
  sanitized = sanitized.replace(/`([^`]+?)`/g, '$1');

  // Remove links [text](url) but keep the text
  sanitized = sanitized.replace(/\[([^\]]+?)\]\([^\)]+?\)/g, '$1');

  // Remove HTML tags
  sanitized = sanitized.replace(/<[^>]+>/g, '');

  // Remove markdown headings (# text, ## text, etc.)
  sanitized = sanitized.replace(/^#+\s+/gm, '');

  // Remove markdown list markers (-, *, +)
  sanitized = sanitized.replace(/^\s*[-*+]\s+/gm, '');

  // Convert escaped newlines to actual spaces or periods
  sanitized = sanitized.replace(/\\n/g, ' ');
  sanitized = sanitized.replace(/\n/g, ' ');

  // Remove extra whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Clean up the text
  sanitized = sanitized.trim();

  return sanitized;
};

module.exports = {
  validateLLMRequest,
  validateTTSRequest,
  sanitizeResponse
};
