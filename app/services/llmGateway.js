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

    // Build token URL dynamically
    this.tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    // Disable SSL verification for development (if needed)
    if (process.env.NODE_ENV === "development") {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
    }
  }

  // Function to get access token from Microsoft
  async getAccessToken() {
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

      const accessToken = await this.getAccessToken();

      console.log("🌐 Making request to:", this.baseURL + "chat/completions");
      console.log("📊 Model:", this.model);

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
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "X-LLM-Gateway-Key": this.apiKey,
            "Content-Type": "application/json",
          },
          timeout: 30000, // 30 second timeout
          responseType: streaming ? "stream" : "json",
          validateStatus: () => true, // Don't throw on any status
        }
      );

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
