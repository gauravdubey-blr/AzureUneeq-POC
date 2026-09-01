/**
 * Request Logger Middleware
 * Logs incoming requests for debugging
 */
const requestLogger = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  
  console.log(`📨 [${timestamp}] ${method} ${path}`);
  
  // Log request body if present (exclude sensitive fields)
  if (Object.keys(req.body).length > 0) {
    const safeBody = { ...req.body };
    if (safeBody.client_secret) safeBody.client_secret = '***';
    if (safeBody.apiKey) safeBody.apiKey = '***';
    console.log(`   Body:`, JSON.stringify(safeBody));
  }
  
  // Capture response time
  const start = Date.now();
  
  // Hook into response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusEmoji = status < 300 ? '✅' : status < 400 ? '⚡' : '❌';
    console.log(`${statusEmoji} [${timestamp}] ${method} ${path} ${status} (${duration}ms)`);
  });

  next();
};

module.exports = requestLogger;
