/**
 * Logger Utilities
 * Centralized logging with emoji indicators
 */

const LOG_LEVELS = {
  ERROR: '❌',
  WARN: '⚠️',
  INFO: 'ℹ️',
  SUCCESS: '✅',
  DEBUG: '🐛',
  STREAM: '🔄',
  API: '🌐'
};

const formatLog = (level, component, message, data = null) => {
  const timestamp = new Date().toISOString();
  const prefix = `${LOG_LEVELS[level]} [${timestamp}] [${component}]`;
  
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
};

module.exports = {
  error: (component, message, data) => formatLog('ERROR', component, message, data),
  warn: (component, message, data) => formatLog('WARN', component, message, data),
  info: (component, message, data) => formatLog('INFO', component, message, data),
  success: (component, message, data) => formatLog('SUCCESS', component, message, data),
  debug: (component, message, data) => formatLog('DEBUG', component, message, data),
  stream: (component, message, data) => formatLog('STREAM', component, message, data),
  api: (component, message, data) => formatLog('API', component, message, data)
};
