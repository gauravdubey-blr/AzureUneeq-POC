const axios = require("axios");
const { createPerformanceLogger } = require("../utils/performanceLogger");

class CortexService {
  constructor() {
    // Azure model endpoint configuration for Cortex flows only.
    this.azureEndpoint =
      process.env.CORTEX_MODEL_ENDPOINT ||
      process.env.OGV_GUARDRAIL_ENDPOINT ||
      process.env.OGV_LLM_ENDPOINT;
    this.azureApiKey =
      process.env.CORTEX_MODEL_API_KEY ||
      process.env.AZURE_EMBEDDING_API_KEY ||
      process.env.OGV_LLM_API_KEY;
    this.azureDeployment =
      process.env.CORTEX_MODEL_DEPLOYMENT ||
      process.env.OGV_GUARDRAIL_DEPLOYMENT ||
      process.env.OGV_LLM_DEPLOYMENT ||
      "gpt-4.1";
    this.azureApiVersion =
      process.env.CORTEX_MODEL_API_VERSION ||
      process.env.OGV_LLM_API_VERSION ||
      "2024-10-21";

    // TLS verification is NOT disabled automatically any more.
    //
    // NODE_TLS_REJECT_UNAUTHORIZED is process-global: setting it here switched
    // off certificate validation for every outbound HTTPS call in the app, not
    // just this service's. It also fired on NODE_ENV=development, which is the
    // default in many local setups. It now requires an explicit, separate
    // opt-in and warns loudly when used.
    if (
      process.env.ALLOW_INSECURE_TLS === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
      console.warn(
        "⚠️  ALLOW_INSECURE_TLS=true — TLS certificate verification is DISABLED " +
          "process-wide. Never use this outside local development.",
      );
    }
  }

  hasAzureModelConfig() {
    return Boolean(this.azureEndpoint && this.azureApiKey && this.azureDeployment);
  }

  normalizedEndpoint(endpoint) {
    return String(endpoint || "").replace(/\/+$/, "");
  }

  isModelsEndpoint(endpoint) {
    const normalized = this.normalizedEndpoint(endpoint).toLowerCase();
    return normalized.includes(".services.ai.azure.com") || normalized.includes("/models");
  }

  buildAzureUrl(endpoint, deployment, apiVersion) {
    const normalized = this.normalizedEndpoint(endpoint);
    const version = encodeURIComponent(apiVersion);

    if (this.isModelsEndpoint(normalized)) {
      const base = normalized.replace(/\/models$/i, "");
      return {
        url: `${base}/models/chat/completions?api-version=${version}`,
        payloadExtras: {
          model: deployment,
        },
      };
    }

    return {
      url:
        `${normalized}/openai/deployments/${encodeURIComponent(deployment)}` +
        `/chat/completions?api-version=${version}`,
      payloadExtras: {},
    };
  }

  buildAzureMessages(question, systemPrompt) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: question });
    return messages;
  }

  async askAzureModel(modelName, question, options = {}) {
    const {
      stream = false,
      systemPrompt = null,
      workflow_timeout = 1800,
    } = options;

    const deployment = modelName || this.azureDeployment;
    const versions = [this.azureApiVersion];
    if (this.isModelsEndpoint(this.azureEndpoint)) {
      versions.push("2024-05-01-preview");
    }

    const uniqueVersions = [...new Set(versions.filter(Boolean))];
    let lastError = null;

    for (const apiVersion of uniqueVersions) {
      const { url, payloadExtras } = this.buildAzureUrl(
        this.azureEndpoint,
        deployment,
        apiVersion,
      );

      console.log("🌐 [Cortex] Azure model endpoint:", url);
      console.log("📊 [Cortex] Deployment:", deployment);

      const requestConfig = {
        headers: {
          "api-key": this.azureApiKey,
          "Content-Type": "application/json",
        },
        timeout: Math.max(workflow_timeout * 1000 + 30000, 300000),
        responseType: stream ? "stream" : "json",
        validateStatus: () => true,
      };

      const basePayload = {
        ...payloadExtras,
        messages: this.buildAzureMessages(question, systemPrompt),
        temperature: 0.7,
        stream,
      };

      let response;
      try {
        response = await axios.post(
          url,
          {
            ...basePayload,
            max_tokens: 2000,
          },
          requestConfig,
        );

        const compatibilityErrorMsg =
          response.data?.error?.message || response.data?.message || "";
        if (
          response.status === 400 &&
          compatibilityErrorMsg.includes("max_tokens") &&
          compatibilityErrorMsg.includes("max_completion_tokens")
        ) {
          console.warn(
            "⚠️ [Cortex] Azure model requires max_completion_tokens; retrying request",
          );
          response = await axios.post(
            url,
            {
              ...basePayload,
              max_completion_tokens: 2000,
            },
            requestConfig,
          );
        }
      } catch (requestError) {
        lastError = requestError;
        console.warn(
          `⚠️ [Cortex] Azure request failed (${requestError.message}); trying next API version if available`,
        );
        continue;
      }

      if (response.status < 400) {
        if (stream) {
          return {
            stream: response.data,
            model: deployment,
            streaming: true,
          };
        }

        const firstChoice = response.data?.choices?.[0];
        const content = firstChoice?.message?.content || "";
        return {
          data: {
            answer: content,
            metadata: {
              model: response.data?.model || deployment,
              usage: response.data?.usage,
              finish_reason: firstChoice?.finish_reason,
            },
            raw: response.data,
          },
          model: response.data?.model || deployment,
          streaming: false,
        };
      }

      const errorMsg =
        response.data?.error?.message ||
        response.data?.message ||
        `Azure model returned status ${response.status}`;
      lastError = new Error(errorMsg);

      if (![401, 403, 404].includes(response.status)) {
        throw lastError;
      }

      console.warn(
        `⚠️ [Cortex] Azure request failed with status ${response.status}; trying next API version if available`,
      );
    }

    throw lastError || new Error("Azure model request failed");
  }

  // Main function to query Cortex route model via Azure Models only
  async askModel(modelName, question, options = {}) {
    const logger = createPerformanceLogger("Cortex API");

    try {
      const {
        stream = false,
        workflow_timeout = 1800,
        systemPrompt = null,
      } = options;

      logger.start("Model Query", {
        model: modelName,
        questionLength: question?.length || 0,
        streaming: stream,
        hasSystemPrompt: !!systemPrompt,
      });

      console.log("🤖 [Cortex] Querying model:", modelName);
      console.log("   Question:", question.substring(0, 50) + "...");
      console.log("   Stream enabled:", stream);
      console.log("   Workflow timeout:", workflow_timeout, "seconds");
      console.log("   System prompt:", systemPrompt ? "ENABLED" : "disabled");

      if (!this.hasAzureModelConfig()) {
        throw new Error(
          "Azure Cortex model config missing. Set CORTEX_MODEL_ENDPOINT, CORTEX_MODEL_API_KEY, CORTEX_MODEL_DEPLOYMENT (or OGV_* fallbacks).",
        );
      }

      const result = await this.askAzureModel(modelName, question, options);
      logger.end({
        streaming: stream,
        statusCode: 200,
      });
      return result;
    } catch (error) {
      logger.error(error);
      console.error("❌ [Cortex] Error querying model:");
      console.error("   Status:", error.response?.status);
      console.error("   URL:", error.config?.url);
      console.error("   Data:", error.response?.data);
      console.error("   Message:", error.message);

      const errorMsg =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`Cortex Query Failed: ${errorMsg}`);
    }
  }
}

module.exports = new CortexService();

// Execute if run directly
if (require.main === module) {
  const service = require("./cortexService");
  service
    .askModel("ibu-fahad-custom-v2-canada-2", "How to use Mounjaro?", {
      stream: false,
    })
    .then((response) => {
      console.log("\nResponse:", JSON.stringify(response.data, null, 2));
    })
    .catch((error) => {
      console.error("Error:", error.message);
      process.exit(1);
    });
}
