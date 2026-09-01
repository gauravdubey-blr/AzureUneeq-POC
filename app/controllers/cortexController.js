/**
 * CortexController
 * Handles Cortex API query requests and responses
 */
const cortexService = require("../services/cortexService");
const LLMResponse = require("../models/LLMResponse");
const CortexRequest = require("../models/CortexRequest");
const { sanitizeResponse } = require("../utils/validators");
// const { MOUNJARO_SYSTEM_PROMPT } = require("../constants/cortexPrompts");
const { createPerformanceLogger } = require("../utils/performanceLogger");

class CortexController {
  /**
   * Handle Cortex query endpoint
   * Supports both streaming and non-streaming responses
   */
  async queryCortex(req, res) {
    try {
      console.log("📨 [CortexController] Received request");

      // Create and validate request
      const cortexRequest = new CortexRequest(req.body);

      if (!cortexRequest.isValid()) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Please provide a question in the request body",
          code: "INVALID_REQUEST",
        });
      }

      console.log(
        `📋 [CortexController] Request details:`,
        cortexRequest.toJSON()
      );

      // Initialize response object
      const cortexResponse = new LLMResponse({
        question: cortexRequest.question,
        sessionId: cortexRequest.sessionId,
        streaming: cortexRequest.streaming,
        model: cortexRequest.modelName,
      });

      // Handle streaming response
      if (cortexRequest.streaming) {
        return this.handleStreamingResponse(
          req,
          res,
          cortexRequest,
          cortexResponse
        );
      }

      // Handle non-streaming response
      return this.handleNonStreamingResponse(
        req,
        res,
        cortexRequest,
        cortexResponse
      );
    } catch (error) {
      console.error("❌ [CortexController] Error:", error);
      return res.status(500).json({
        error: "Server Error",
        message: error.message,
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  }

  /**
   * Handle streaming response
   */
  async handleStreamingResponse(req, res, cortexRequest, cortexResponse) {
    const streamLogger = createPerformanceLogger("Cortex Streaming");
    streamLogger.start("Complete Stream Processing", {
      model: cortexRequest.modelName,
      questionLength: cortexRequest.question.length,
    });

    try {
      console.log("🔄 [CortexController] Starting streaming response");

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Send start event
      res.write(cortexResponse.toSSE("start", ""));
      console.log("✅ [CortexController] Sent start event");

      const apiResponse = await cortexService.askModel(
        cortexRequest.modelName,
        cortexRequest.question,
        cortexRequest.getOptions()
      );

      if (!apiResponse.streaming || !apiResponse.stream) {
        throw new Error("No stream returned from Cortex API");
      }

      // Stream parsing - Cortex uses JSON lines with message_fragment
      let lineBuffer = "";
      let fullResponse = "";
      let tokenCount = 0;
      let firstTokenTime = null;
      let eventDataLines = []; // Accumulates data: lines for current event

      const flushEvent = () => {
        if (eventDataLines.length === 0) return;
        const payload = eventDataLines.join("\n");
        eventDataLines = [];

        if (payload === "[DONE]") {
          return "DONE";
        }

        try {
          const parsed = JSON.parse(payload);
          return parsed;
        } catch (err) {
          console.warn(
            "⚠️ [CortexController] Deferred JSON parse (partial frame):",
            payload.substring(0, 80)
          );
          eventDataLines = [payload];
          return null;
        }
      };

      // Handle stream events - Cortex sends JSON lines directly (not SSE format)
      apiResponse.stream.on("data", (chunk) => {
        const chunkStr = chunk.toString();

        lineBuffer += chunkStr;
        let newlineIndex;

        while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
          const rawLine = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
          lineBuffer = lineBuffer.slice(newlineIndex + 1);

          if (rawLine === "") {
            // Blank line signals end of event
            const done = flushEvent();
            if (done === "DONE") return;
            continue;
          }

          if (rawLine.startsWith("data:")) {
            // Collect data line for current event
            const dataPayload = rawLine.slice(5).trim();
            if (dataPayload) eventDataLines.push(dataPayload);
          } else {
            // Cortex API sends JSON objects directly (not SSE format)
            try {
              const parsed = JSON.parse(rawLine);

              // Extract message content from Cortex format
              if (parsed.type === "message" && parsed.message_fragment) {
                const token = parsed.message_fragment;
                fullResponse += token;

                // Split token into smaller chunks for smoother streaming display
                const words = token.split(/(\s+)/);

                for (const word of words) {
                  if (word && word.trim()) {
                    tokenCount++;

                    // Track time to first token
                    if (tokenCount === 1) {
                      firstTokenTime = Date.now();
                    }

                    res.write(cortexResponse.toSSE("token", word));

                    if (tokenCount % 10 === 0) {
                      console.log(
                        `✅ [CortexController] Streamed ${tokenCount} tokens`
                      );
                    }
                  }
                }
              }
            } catch (err) {
              // Not valid JSON, might be partial - skip
              if (rawLine.trim()) {
                console.warn(
                  "⚠️ [CortexController] Invalid JSON line:",
                  rawLine.substring(0, 80)
                );
              }
            }
          }
        }
      });

      // Handle stream end
      apiResponse.stream.on("end", () => {
        const endTime = Date.now();
        const timeToFirstToken = firstTokenTime
          ? firstTokenTime - streamLogger.startTime
          : 0;

        console.log(
          `✅ [CortexController] Stream ended. Total tokens: ${tokenCount}`
        );

        // Log complete streaming performance
        const perfResult = streamLogger.end({
          tokenCount: tokenCount,
          timeToFirstToken: `${timeToFirstToken}ms`,
          averageTokenTime:
            tokenCount > 0
              ? `${(
                  (endTime - (firstTokenTime || streamLogger.startTime)) /
                  tokenCount
                ).toFixed(2)}ms`
              : "N/A",
        });

        // Update response with complete data
        cortexResponse.response = sanitizeResponse(fullResponse);
        cortexResponse.usage = {
          completion_tokens: tokenCount,
          prompt_tokens: cortexRequest.question.split(" ").length,
          total_tokens: tokenCount + cortexRequest.question.split(" ").length,
        };

        // Send metadata event
        const metadata = {
          chatId: cortexResponse.chatId,
          chatMessageId: cortexResponse.chatMessageId,
          question: cortexResponse.question,
          sessionId: cortexResponse.sessionId,
          tokenCount: tokenCount,
          model: cortexResponse.model,
          timestamp: cortexResponse.timestamp,
          performance: {
            totalDuration: `${perfResult.duration}ms`,
            timeToFirstToken: `${timeToFirstToken}ms`,
            tokensPerSecond:
              tokenCount > 0
                ? (tokenCount / (perfResult.duration / 1000)).toFixed(2)
                : 0,
          },
        };
        res.write(cortexResponse.toSSE("metadata", metadata));

        // Send end event
        res.write(cortexResponse.toSSE("end", "[DONE]"));
        res.end();
        console.log("🏁 [CortexController] Streaming completed successfully");
      });

      // Handle stream error
      apiResponse.stream.on("error", (error) => {
        streamLogger.error(error);
        console.error("❌ [CortexController] Stream error:", error);
        if (!res.headersSent) {
          res.write(
            cortexResponse.toSSE("error", {
              message: error.message,
              code: "STREAM_ERROR",
            })
          );
        }
        if (!res.writableEnded) {
          res.end();
        }
      });
    } catch (error) {
      streamLogger.error(error);
      console.error("❌ [CortexController] Streaming error:", error);

      // Only send error response if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(500).json({
          error: "Streaming Failed",
          message: error.message,
          code: "STREAMING_FAILED",
        });
      } else if (!res.writableEnded) {
        // If headers already sent but stream not ended, end it
        res.end();
      }
    }
  }

  /**
   * Handle non-streaming response
   */
  async handleNonStreamingResponse(req, res, cortexRequest, cortexResponse) {
    try {
      console.log("📄 [CortexController] Processing non-streaming response");

      const response = await cortexService.askModel(
        cortexRequest.modelName,
        cortexRequest.question,
        cortexRequest.getOptions()
      );

      if (!response.data) {
        throw new Error("Invalid response from Cortex API");
      }

      // Extract response text from Cortex API response
      let responseText =
        response.data?.answer ||
        response.data?.response ||
        response.data?.message ||
        response.data;

      // Ensure responseText is a string
      if (typeof responseText !== "string") {
        // If it's still an object, try to stringify it or extract text
        if (typeof responseText === "object") {
          responseText = JSON.stringify(responseText);
        } else {
          responseText = String(responseText || "");
        }
      }

      // Sanitize response to remove markdown and special characters
      responseText = sanitizeResponse(responseText);

      // Update response with complete data
      cortexResponse.response = responseText;
      cortexResponse.addUsage({
        completion_tokens: responseText.split(" ").length,
        prompt_tokens: cortexRequest.question.split(" ").length,
        total_tokens:
          responseText.split(" ").length +
          cortexRequest.question.split(" ").length,
      });

      console.log("✅ [CortexController] Non-streaming response ready");

      // Return JSON response
      return res.json({
        // chatId: cortexResponse.chatId,
        // chatMessageId: cortexResponse.chatMessageId,
        // question: cortexResponse.question,
        // sessionId: cortexResponse.sessionId,
        text: cortexResponse.response,
        metadata: {
          model: cortexResponse.model,
          timestamp: cortexResponse.timestamp,
          streaming: false,
          usage: cortexResponse.usage,
          ...response.data?.metadata,
        },
      });
    } catch (error) {
      console.error("❌ [CortexController] Non-streaming error:", error);
      return res.status(500).json({
        error: "Cortex Query Failed",
        message: error.message,
        code: "CORTEX_QUERY_FAILED",
      });
    }
  }
}

module.exports = new CortexController();
