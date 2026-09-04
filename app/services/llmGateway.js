const axios = require("axios");

class LLMGatewayService {
  constructor() {
    // Azure model configuration only.
    this.azureEndpoint = process.env.OGV_LLM_ENDPOINT;
    this.azureApiKey = process.env.OGV_LLM_API_KEY;
    this.azureDeployment = process.env.OGV_LLM_DEPLOYMENT;
    this.azureApiVersion = process.env.OGV_LLM_API_VERSION || "2024-10-21";

    // Secondary Azure model configuration (fallbacks).
    this.azureFallbackEndpoint =
      process.env.OGV_GUARDRAIL_ENDPOINT || process.env.AZURE_EMBEDDING_ENDPOINT;
    this.azureFallbackApiKey = process.env.AZURE_EMBEDDING_API_KEY;
    this.azureFallbackDeployment = process.env.OGV_GUARDRAIL_DEPLOYMENT;

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

  hasAzureFallbackConfig() {
    return Boolean(
      this.azureFallbackEndpoint &&
        this.azureFallbackApiKey &&
        (this.azureDeployment || this.azureFallbackDeployment),
    );
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

  // Main function to query the LLM via Azure Models only
  async queryLLM(prompt = "What is the capital of France?", streaming = true) {
    try {
      console.log(
        "🤖 Querying LLM with prompt:",
        prompt.substring(0, 50) + "..."
      );
      console.log("📡 Streaming enabled:", streaming);

      if (!this.hasAzureModelConfig() && !this.hasAzureFallbackConfig()) {
        throw new Error(
          "Azure Models not configured. Set OGV_LLM_ENDPOINT, OGV_LLM_API_KEY, OGV_LLM_DEPLOYMENT (or OGV_GUARDRAIL_ENDPOINT + AZURE_EMBEDDING_API_KEY + OGV_GUARDRAIL_DEPLOYMENT).",
        );
      }

      return await this.queryAzureModel(prompt, streaming);
    } catch (error) {
      console.error("❌ Error querying LLM:");
      console.error("   Status:", error.response?.status);
      console.error("   URL:", error.config?.url);
      console.error("   Data:", error.response?.data);
      console.error("   Message:", error.message);

      const errorMsg =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message;
      throw new Error(`LLM Query Failed: ${errorMsg}`);
    }
  }

  async queryAzureModel(prompt, streaming) {
    const candidates = [];

    if (this.hasAzureModelConfig()) {
      candidates.push({
        endpoint: this.azureEndpoint,
        apiKey: this.azureApiKey,
        deployment: this.azureDeployment,
        apiVersion: this.azureApiVersion,
      });
    }

    if (this.hasAzureFallbackConfig()) {
      candidates.push({
        endpoint: this.azureFallbackEndpoint,
        apiKey: this.azureFallbackApiKey,
        deployment: this.azureDeployment || this.azureFallbackDeployment,
        apiVersion: this.azureApiVersion,
      });
    }

    let lastError = null;

    for (const candidate of candidates) {
      const versions = [candidate.apiVersion];
      if (this.isModelsEndpoint(candidate.endpoint)) {
        versions.push("2024-05-01-preview");
      }

      const uniqueVersions = [...new Set(versions.filter(Boolean))];

      for (const apiVersion of uniqueVersions) {
        const { url, payloadExtras } = this.buildAzureUrl(
          candidate.endpoint,
          candidate.deployment,
          apiVersion,
        );

        console.log("🌐 Using Azure model endpoint:", url);
        console.log("📊 Deployment:", candidate.deployment);

        const requestConfig = {
          headers: {
            "api-key": candidate.apiKey,
            "Content-Type": "application/json",
          },
          timeout: 30000,
          responseType: streaming ? "stream" : "json",
          validateStatus: () => true,
        };

        const basePayload = {
          ...payloadExtras,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          stream: streaming,
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
              "⚠️ Azure model requires max_completion_tokens; retrying request",
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
            `⚠️ Azure model request failed (${requestError.message}); trying next candidate if available`,
          );
          continue;
        }

        if (response.status < 400) {
          if (streaming) {
            return {
              stream: response.data,
              model: candidate.deployment,
              streaming: true,
            };
          }

          return {
            choices: response.data.choices,
            model: response.data.model || candidate.deployment,
            usage: response.data.usage,
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
          `⚠️ Azure model candidate failed with status ${response.status}; trying next candidate if available`,
        );
      }
    }

    throw lastError || new Error("Azure model request failed");
  }
}

module.exports = new LLMGatewayService();

// Execute if run directly
if (require.main === module) {
  const service = require("./llmGateway");
  service
    .queryLLM()
    .then((response) => {
      if (response.streaming) {
        console.log("\nStreaming response opened");
      } else {
        console.log("\nResponse:", response.choices[0].message.content);
      }
    })
    .catch((error) => {
      console.error("Error:", error.message);
      process.exit(1);
    });
}
