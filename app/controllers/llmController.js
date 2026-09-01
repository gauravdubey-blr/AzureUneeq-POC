/**
 * LLMController
 * Handles LLM query requests and responses
 */
const LLMRequest = require("../models/LLMRequest");
const LLMResponse = require("../models/LLMResponse");
const llmGatewayService = require("../services/llmGateway");
const { sanitizeResponse } = require("../utils/validators");

class LLMController {
  /**
   * Handle LLM query endpoint
   * Supports both streaming and non-streaming responses
   */
  async queryLLM(req, res) {
    try {
      console.log("📨 [LLMController] Received request");

      // Create and validate request
      const llmRequest = new LLMRequest(req.body);

      if (!llmRequest.isValid()) {
        return res.status(400).json({
          error: "Invalid Request",
          message: "Please provide a question in the request body",
          code: "INVALID_REQUEST",
        });
      }

      console.log(`📋 [LLMController] Request details:`, llmRequest.toJSON());

      // Initialize response object
      const llmResponse = new LLMResponse({
        question: llmRequest.question,
        sessionId: llmRequest.sessionId,
        streaming: llmRequest.streaming,
        model: llmRequest.model,
      });

      // Handle streaming response
      if (llmRequest.streaming) {
        return this.handleStreamingResponse(req, res, llmRequest, llmResponse);
      }

      // Handle non-streaming response
      return this.handleNonStreamingResponse(req, res, llmRequest, llmResponse);
    } catch (error) {
      console.error("❌ [LLMController] Error:", error);
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
  async handleStreamingResponse(req, res, llmRequest, llmResponse) {
    try {
      console.log("🔄 [LLMController] Starting streaming response");

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Send start event
      res.write(llmResponse.toSSE("start", ""));
      console.log("✅ [LLMController] Sent start event");

      let fullResponse = "";
      let tokenCount = 0;

      // Query LLM with streaming
      const apiResponse = await llmGatewayService.queryLLM(
        llmRequest.question,
        true
      );

      if (!apiResponse.stream) {
        throw new Error("No stream returned from LLM Gateway");
      }

      // Stream parsing using line-based SSE framing to avoid partial JSON errors
      let lineBuffer = ""; // Accumulates raw text until a newline is found
      let eventDataLines = []; // Accumulates data: lines for current event

      const flushEvent = () => {
        if (eventDataLines.length === 0) return;
        const payload = eventDataLines.join("\n"); // usually single line
        eventDataLines = [];

        if (payload === "[DONE]") {
          return "DONE";
        }

        try {
          const parsed = JSON.parse(payload);

          // Extract token from stream chunk
          if (parsed.choices && parsed.choices[0]?.delta?.content) {
            const token = parsed.choices[0].delta.content;
            fullResponse += token;

            // Split token into smaller chunks for smoother streaming display
            const words = token.split(/(\s+)/);

            for (const word of words) {
              if (word && word.trim()) {
                tokenCount++;
                res.write(llmResponse.toSSE("token", word));

                if (tokenCount % 10 === 0) {
                  console.log(
                    `✅ [LLMController] Streamed ${tokenCount} tokens`
                  );
                }
              }
            }
          }
        } catch (err) {
          // Incomplete JSON (frame split across chunks) -> requeue payload
          console.warn(
            "⚠️ [LLMController] Deferred JSON parse (partial frame):",
            payload.substring(0, 80)
          );
          eventDataLines = [payload];
        }
        return null;
      };

      // Handle stream events with robust SSE parser
      apiResponse.stream.on("data", (chunk) => {
        lineBuffer += chunk.toString();
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
          }
        }
      });

      // Handle stream end
      apiResponse.stream.on("end", () => {
        // Flush any remaining event
        flushEvent();

        console.log(
          `✅ [LLMController] Stream ended. Total tokens: ${tokenCount}`
        );

        // Update response with complete data
        llmResponse.response = fullResponse;
        llmResponse.usage = {
          completion_tokens: tokenCount,
          prompt_tokens: llmRequest.question.split(" ").length,
          total_tokens: tokenCount + llmRequest.question.split(" ").length,
        };

        // Send metadata event
        const metadata = {
          chatId: llmResponse.chatId,
          chatMessageId: llmResponse.chatMessageId,
          question: llmResponse.question,
          sessionId: llmResponse.sessionId,
          tokenCount: tokenCount,
          model: llmResponse.model,
          timestamp: llmResponse.timestamp,
        };
        res.write(llmResponse.toSSE("metadata", metadata));

        // Send end event
        res.write(llmResponse.toSSE("end", "[DONE]"));
        res.end();
        console.log("🏁 [LLMController] Streaming completed successfully");
      });

      // Handle stream error
      apiResponse.stream.on("error", (error) => {
        console.error("❌ [LLMController] Stream error:", error);
        res.write(
          llmResponse.toSSE("error", {
            message: error.message,
            code: "STREAM_ERROR",
          })
        );
        res.end();
      });
    } catch (error) {
      console.error("❌ [LLMController] Streaming error:", error);
      res.write(
        llmResponse.toSSE("error", {
          message: error.message,
          code: "STREAMING_FAILED",
        })
      );
      res.end();
    }
  }

  /**
   * Handle non-streaming response
   */
  async handleNonStreamingResponse(req, res, llmRequest, llmResponse) {
    try {
      console.log("📄 [LLMController] Processing non-streaming response");

      // Query LLM without streaming
      const apiResponse = await llmGatewayService.queryLLM(
        llmRequest.question,
        false
      );

      if (!apiResponse.choices || !apiResponse.choices[0]) {
        throw new Error("Invalid response from LLM Gateway");
      }

      // Extract response content
      const responseContent = apiResponse.choices[0].message?.content;
      if (!responseContent) {
        throw new Error("No content in LLM response");
      }

      // Build final response with sanitized content
      llmResponse.response = sanitizeResponse(responseContent);
      llmResponse.addUsage(apiResponse.usage);

      console.log("✅ [LLMController] Non-streaming response ready");

      // Return JSON response
      return res.json({
        // chatId: llmResponse.chatId,
        // chatMessageId: llmResponse.chatMessageId,
        // question: llmResponse.question,
        // sessionId: llmResponse.sessionId,
        text: llmResponse.response,
        metadata: {
          model: llmResponse.model,
          timestamp: llmResponse.timestamp,
          streaming: false,
          usage: llmResponse.usage,
        },
      });
    } catch (error) {
      console.error("❌ [LLMController] Non-streaming error:", error);
      return res.status(500).json({
        error: "LLM Query Failed",
        message: error.message,
        code: "LLM_QUERY_FAILED",
      });
    }
  }
}

module.exports = new LLMController();
