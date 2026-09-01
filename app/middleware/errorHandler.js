/**
 * Error Handler Middleware
 * Centralized error handling for all routes
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ [ErrorHandler] Caught error:', {
    message: err.message,
    code: err.code,
    status: err.status || 500,
    stack: err.stack
  });

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';

  return res.status(status).json({
    error: message,
    code: code,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;
