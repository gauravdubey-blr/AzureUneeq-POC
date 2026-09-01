/**
 * Performance Logger Utility
 * Tracks and logs execution time for service calls
 */

class PerformanceLogger {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.startTime = null;
    this.endTime = null;
    this.metadata = {};
  }

  /**
   * Start timing
   */
  start(operation, metadata = {}) {
    this.operation = operation;
    this.startTime = Date.now();
    this.metadata = metadata;

    console.log(`⏱️  [${this.serviceName}] Starting: ${operation}`);
    if (Object.keys(metadata).length > 0) {
      console.log(`   Metadata:`, metadata);
    }

    return this;
  }

  /**
   * End timing and log duration
   */
  end(result = {}) {
    this.endTime = Date.now();
    const duration = this.endTime - this.startTime;

    console.log(`✅ [${this.serviceName}] Completed: ${this.operation}`);
    console.log(
      `   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`
    );

    if (Object.keys(result).length > 0) {
      console.log(`   Result:`, result);
    }

    return {
      serviceName: this.serviceName,
      operation: this.operation,
      duration,
      durationSeconds: (duration / 1000).toFixed(2),
      startTime: this.startTime,
      endTime: this.endTime,
      metadata: this.metadata,
      result,
    };
  }

  /**
   * Log error with timing
   */
  error(error) {
    this.endTime = Date.now();
    const duration = this.endTime - this.startTime;

    console.error(`❌ [${this.serviceName}] Failed: ${this.operation}`);
    console.error(
      `   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`
    );
    console.error(`   Error:`, error.message);

    return {
      serviceName: this.serviceName,
      operation: this.operation,
      duration,
      durationSeconds: (duration / 1000).toFixed(2),
      startTime: this.startTime,
      endTime: this.endTime,
      metadata: this.metadata,
      error: error.message,
    };
  }
}

/**
 * Factory function to create performance logger
 */
function createPerformanceLogger(serviceName) {
  return new PerformanceLogger(serviceName);
}

/**
 * Express middleware to log request performance
 */
function requestPerformanceLogger(serviceName = "API") {
  return (req, res, next) => {
    const logger = new PerformanceLogger(serviceName);
    const operation = `${req.method} ${req.path}`;
    const startTimeHR = process.hrtime();

    logger.start(operation, {
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body?.question
        ? { question: req.body.question.substring(0, 50) + "..." }
        : {},
    });

    // Store logger on response object
    res.performanceLogger = logger;

    // Intercept response end to calculate precise timing
    const originalEnd = res.end;

    res.end = function (...args) {
      // Calculate high-precision timing
      const [seconds, nanoseconds] = process.hrtime(startTimeHR);
      const durationMs = seconds * 1000 + nanoseconds / 1000000;
      
      const performanceData = {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
      };

      logger.end(performanceData);

      // Add response headers with timing data for client access
      res.setHeader("X-Response-Time", `${durationMs.toFixed(2)}ms`);
      res.setHeader("X-Endpoint-Path", req.path);
      res.setHeader("X-Endpoint-Method", req.method);
      res.setHeader("X-Endpoint-Status", res.statusCode.toString());

      originalEnd.apply(res, args);
    };

    next();
  };
}

module.exports = {
  PerformanceLogger,
  createPerformanceLogger,
  requestPerformanceLogger,
};
