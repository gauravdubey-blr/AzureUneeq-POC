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

  // Azure Speech Services configuration.
  //
  // NOTE: voice endpoints, region, key, default voice and format are resolved in
  // config/voiceInstance.js — that module is the single source of truth for voice
  // input/output and is what the STT/TTS services read. The fields here remain
  // for backward compatibility with existing callers of `config.azure.speech`.
  azure: {
    speech: {
      region: process.env.AZURE_VOICE_REGION || process.env.AZURE_SPEECH_REGION || "eastus2",
      subscriptionKey:
        process.env.AZURE_VOICE_KEY ||
        process.env.AZURE_SUBSCRIPTION_KEY ||
        process.env.AZURE_SPEECH_KEY,
      voice: process.env.AZURE_VOICE_TTS_VOICE || "en-US-AriaNeural",
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

  // Azure model endpoint configuration (only model runtime path)
  azureModels: {
    llm: {
      endpoint: process.env.OGV_LLM_ENDPOINT,
      apiKey: process.env.OGV_LLM_API_KEY,
      deployment: process.env.OGV_LLM_DEPLOYMENT,
      apiVersion: process.env.OGV_LLM_API_VERSION || "2024-10-21",
    },
    cortex: {
      endpoint:
        process.env.CORTEX_MODEL_ENDPOINT ||
        process.env.OGV_GUARDRAIL_ENDPOINT ||
        process.env.OGV_LLM_ENDPOINT,
      apiKey:
        process.env.CORTEX_MODEL_API_KEY ||
        process.env.AZURE_EMBEDDING_API_KEY ||
        process.env.OGV_LLM_API_KEY,
      deployment:
        process.env.CORTEX_MODEL_DEPLOYMENT ||
        process.env.OGV_GUARDRAIL_DEPLOYMENT ||
        process.env.OGV_LLM_DEPLOYMENT,
      apiVersion:
        process.env.CORTEX_MODEL_API_VERSION ||
        process.env.OGV_LLM_API_VERSION ||
        "2024-10-21",
    },
  },

};

/**
 * Validate required environment variables
 */
function validateConfig() {
  const { clientId, clientSecret, tenantId } = config.azure.auth;

  if (!clientId || !clientSecret || !tenantId) {
    console.warn(
      "Warning: Missing Azure AD credentials (CLIENT_ID, CLIENT_SECRET, TENANT_ID). Auth-dependent routes may be unavailable.",
    );
    console.warn("CLIENT_ID:", clientId ? "✓ Set" : "✗ Missing");
    console.warn("CLIENT_SECRET:", clientSecret ? "✓ Set" : "✗ Missing");
    console.warn("TENANT_ID:", tenantId ? "✓ Set" : "✗ Missing");
  } else {
    console.log("✓ Azure AD credentials configured");
  }

  // Report which voice instance resolved, and surface any gaps in it.
  const voiceInstance = require("./voiceInstance");
  const view = voiceInstance.publicView();
  console.log("🎙️  Voice instance:", JSON.stringify(view));
  for (const w of voiceInstance.voice.warnings) {
    console.warn(`⚠️  ${w}`);
  }
  if (view.ready) {
    console.log("✓ Voice input/output configured");
  } else {
    console.warn(
      "Warning: voice instance not ready — /api/voice/* and the legacy speech routes will return 503",
    );
  }

  // Validate Azure LLM model configuration (preferred path)
  const azureLlmReady =
    !!config.azureModels.llm.endpoint &&
    !!config.azureModels.llm.apiKey &&
    !!config.azureModels.llm.deployment;
  if (azureLlmReady) {
    console.log("✓ Azure LLM model configuration detected");
  } else {
    console.warn(
      "Warning: Azure LLM model config incomplete (need OGV_LLM_ENDPOINT, OGV_LLM_API_KEY, OGV_LLM_DEPLOYMENT)",
    );
  }

  // Validate Azure Cortex model configuration (preferred path)
  const azureCortexReady =
    !!config.azureModels.cortex.endpoint &&
    !!config.azureModels.cortex.apiKey &&
    !!config.azureModels.cortex.deployment;
  if (azureCortexReady) {
    console.log("✓ Azure Cortex model configuration detected");
  } else {
    console.warn(
      "Warning: Azure Cortex model config incomplete (need CORTEX_MODEL_* or OGV_GUARDRAIL/OGV_LLM fallbacks)",
    );
  }

  console.log("✓ Model routing configured for Azure Models only");

  console.log("✓ Configuration validated successfully");
}

module.exports = {
  config,
  validateConfig,
};
