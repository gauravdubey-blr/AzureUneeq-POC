const axios = require("axios");
const { config } = require("../config/config");

class LLMGatewayService {
  constructor() {
    // Configuration from config.js
    this.clientId = config.llmGateway.clientId;
    this.clientSecret = config.llmGateway.clientSecret;
    this.tenantId = config.llmGateway.tenantId;
    this.apiKey = config.llmGateway.apiKey;
    this.model = config.llmGateway.model;
    this.baseURL = config.llmGateway.baseURL;
    this.scope = config.llmGateway.scope;

    // Direct Azure model configuration.
    this.azureEndpoint = process.env.OGV_LLM_ENDPOINT;
    this.azureApiKey = process.env.OGV_LLM_API_KEY;
    this.azureDeployment = process.env.OGV_LLM_DEPLOYMENT;
    this.azureApiVersion = process.env.OGV_LLM_API_VERSION || "2024-10-21";

    // Secondary Azure model configuration (fallbacks).
    this.azureFallbackEndpoint =
      process.env.OGV_GUARDRAIL_ENDPOINT || process.env.AZURE_EMBEDDING_ENDPOINT;
    this.azureFallbackApiKey = process.env.AZURE_EMBEDDING_API_KEY;
    this.azureFallbackDeployment = process.env.OGV_GUARDRAIL_DEPLOYMENT;

    // Build token URL dynamically
    this.tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

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

  hasAadCredentials() {
    return Boolean(this.clientId && this.clientSecret && this.tenantId);
  }

  hasGatewayKey() {
    return Boolean(this.apiKey);
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

  normalizedAzureEndpoint() {
    return String(this.azureEndpoint || "").replace(/\/+$/, "");
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

  // Function to get access token from Microsoft
  async getAccessToken() {
    if (!this.hasAadCredentials()) {
      throw new Error(
        "LLM Gateway AAD credentials are not configured (LLM_CLIENT_ID, LLM_CLIENT_SECRET, LLM_TENANT_ID)",
      );
    }

    const tokenPayload = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    try {
      console.log("🔑 Requesting access token from Microsoft...");
      console.log("   Token URL:", this.tokenUrl);
      console.log(
        "   Client ID:",
        this.clientId ? `***${this.clientId.slice(-8)}` : "NOT SET"
      );

      const tokenResponse = await axios.post(this.tokenUrl, tokenPayload, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      console.log("✅ Access token received successfully");
      return tokenResponse.data.access_token;
    } catch (error) {
      console.error("❌ Error getting access token:");
      console.error("   Status:", error.response?.status);
      console.error("   Data:", error.response?.data);
      console.error("   Message:", error.message);
      throw new Error(
        `Token request failed: ${
          error.response?.data?.error_description || error.message
        }`
      );
    }
  }

  // Main function to query the LLM
  async queryLLM(prompt = "What is the capital of France?", streaming = true) {
    try {
      console.log(
        "🤖 Querying LLM with prompt:",
        prompt.substring(0, 50) + "..."
      );
      console.log("📡 Streaming enabled:", streaming);

      if (this.hasAzureModelConfig()) {
        return await this.queryAzureModel(prompt, streaming);
      }

      if (!this.hasGatewayKey() && !this.hasAadCredentials()) {
        throw new Error(
          "LLM is not configured. Provide Azure model settings (OGV_LLM_ENDPOINT, OGV_LLM_API_KEY, OGV_LLM_DEPLOYMENT) or gateway settings.",
        );
      }

      let accessToken = null;
      if (this.hasAadCredentials()) {
        accessToken = await this.getAccessToken();
      } else {
        console.warn(
          "⚠️  LLM AAD credentials missing; attempting API key-only gateway request",
        );
      }

      console.log("🌐 Making request to:", this.baseURL + "chat/completions");
      console.log("📊 Model:", this.model);

      const headers = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      if (this.apiKey) {
        headers["X-LLM-Gateway-Key"] = this.apiKey;
      }

      // Query the model using direct API call
      const response = await axios.post(
        `${this.baseURL}chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 2000,
          stream: streaming,
        },
        {
          headers,
          timeout: 30000, // 30 second timeout
          responseType: streaming ? "stream" : "json",
          validateStatus: () => true, // Don't throw on any status
        }
      );

      if (response.status >= 400) {
        const errorMsg =
          response.data?.error?.message ||
          response.data?.message ||
          `LLM Gateway returned status ${response.status}`;
        throw new Error(errorMsg);
      }

      console.log("✅ LLM Response received successfully");

      // For streaming, return the stream object directly
      if (streaming) {
        return {
          stream: response.data,
          model: this.model,
          streaming: true,
        };
      }

      // Return in OpenAI format for consistency (non-streaming)
      return {
        choices: response.data.choices,
        model: response.data.model,
        usage: response.data.usage,
        streaming: false,
      };
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
      console.log("\nResponse:", response.choices[0].message.content);
    })
    .catch((error) => {
      console.error("Error:", error.message);
      process.exit(1);
    });
}
