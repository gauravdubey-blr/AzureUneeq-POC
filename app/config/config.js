// Load environment variables
require("dotenv").config();

/**
 * Application configuration module
 * Centralizes all environment variables and configuration settings
 */

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
  },

  // Azure Speech Services configuration
  azure: {
    speech: {
      region: "eastus2",
      subscriptionKey: process.env.AZURE_SUBSCRIPTION_KEY,
      voice: "en-US-AriaNeural",
      speakingStyle: "friendly",
      outputFormat: process.env.AZURE_OUTPUT_FORMAT,
      prosodySpeed: "medium",
      prosodyPitch: "medium",
      useSpeakingStyle: "false",
      nlpOutputsSsml: "false",
      useSsml: "false",
    },

    // Azure MSAL configuration
    auth: {
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      tenantId: process.env.TENANT_ID,
      scope: ["api://ibu-digital-assistant.lilly.com/.default"],
    },
  },

  // LLM Gateway configuration
  llmGateway: {
    clientId: process.env.LLM_CLIENT_ID,
    clientSecret: process.env.LLM_CLIENT_SECRET,
    tenantId: process.env.LLM_TENANT_ID,
    apiKey: process.env.LLM_GATEWAY_KEY,
    model: process.env.LLM_MODEL || "gpt-4o",
    baseURL:
      process.env.LLM_GATEWAY_BASE_URL ||
      "https://gateway.apim-dev.lilly.com/llm-gateway/",
    tokenUrl: process.env.LLM_TOKEN_URL,
    scope: process.env.LLM_SCOPE || "api://llm-gateway.lilly.com/.default",
  },

  // Cortex API configuration
  cortex: {
    clientId: process.env.CORTEX_CLIENT_ID,
    clientSecret: process.env.CORTEX_CLIENT_SECRET,
    tenantId: process.env.CORTEX_TENANT_ID,
    baseURL: process.env.CORTEX_BASE_URL || "https://api.cortex.lilly.com",
    scope: process.env.CORTEX_SCOPE || "api://cortex.lilly.com/.default",
    tokenUrl: process.env.CORTEX_TOKEN_URL,
  },
};

/**
 * Validate required environment variables
 */
function validateConfig() {
  const { clientId, clientSecret, tenantId } = config.azure.auth;

  if (!clientId || !clientSecret || !tenantId) {
    console.error(
      "Error: Missing required Azure credentials in environment variables:",
    );
    console.error("CLIENT_ID:", clientId ? "✓ Set" : "✗ Missing");
    console.error("CLIENT_SECRET:", clientSecret ? "✓ Set" : "✗ Missing");
    console.error("TENANT_ID:", tenantId ? "✓ Set" : "✗ Missing");
    console.error("Please check your .env file and add the missing values.");
    process.exit(1);
  }

  // Validate Azure Speech Services region (token auth doesn't need API key)
  if (!config.azure.speech.region) {
    console.warn(
      "Warning: Azure Speech Services region not configured. TTS functionality may not work.",
    );
  } else {
    console.log(
      "✓ Azure Speech Services region configured for token-based authentication",
    );
  }

  // Validate LLM Gateway configuration
  const {
    apiKey,
    clientId: llmClientId,
    clientSecret: llmClientSecret,
    tenantId: llmTenantId,
  } = config.llmGateway;

  if (!apiKey) {
    console.warn(
      "Warning: LLM_GATEWAY_KEY not configured. LLM Gateway functionality may not work.",
    );
  } else {
    console.log("✓ LLM Gateway API key configured");
  }

  if (!llmClientId || !llmClientSecret || !llmTenantId) {
    console.warn(
      "Warning: Missing LLM Gateway Azure credentials (LLM_CLIENT_ID, LLM_CLIENT_SECRET, LLM_TENANT_ID).",
    );
  } else {
    console.log("✓ LLM Gateway Azure credentials configured");
  }

  console.log("✓ Configuration validated successfully");
}

module.exports = {
  config,
  validateConfig,
};
