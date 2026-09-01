const axios = require("axios");
const { config } = require("../config/config");
const azureAuthService = require("./azureAuthService");
const { PassThrough } = require("stream");
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const { createPerformanceLogger } = require("../utils/performanceLogger");

class AzureTTSService {
  constructor() {
    // Azure End point
    // this.endpoint = `https://dev-buaidigassist-speechservice-eastus2domain.cognitiveservices.azure.com/tts/cognitiveservices/v1`;
    // this.endpoint = `https://eastus2.tts.speech.microsoft.com/cognitiveservices/v1`;
    // APIM End point
    //this.endpoint = `https://gateway.apim-dev.lilly.com/bu-aidigassist/tts/cognitiveservices/v1`;
    //Azure end point
    this.endpoint='https://eastus2.api.cognitive.microsoft.com/tts/cognitiveservices/v1'

  }

  stripUneeqTags(text) {
    if (!text) return "";
    return text.replace(/<uneeq-[^>]*>/g, "").trim();
  }

  async textToSpeech(
    text,
    voiceName = "en-US-AriaNeural",
    apiKey,
    outputFormat = "riff-16khz-16bit-mono-pcm" // Use PCM format as default
  ) {
    const logger = createPerformanceLogger("Azure TTS");
    logger.start("Text-to-Speech Conversion", {
      voice: voiceName,
      format: outputFormat,
      textLength: text?.length || 0,
    });

    try {
      // Fix SSL certificate issue for development
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

      const cleanText = this.stripUneeqTags(text);

      // Get access token from Azure Auth Service
      console.log("🔑 Getting access token from Azure Auth Service...");
      const token = await azureAuthService.getAccessToken();
      console.log("✅ Token received, length:", token?.length || "undefined");

      // Use the apiKey parameter if provided, otherwise use config
      const subscriptionKey = apiKey || config.azure.speech.subscriptionKey;

      console.log(
        "🔑 Using Subscription Key:",
        subscriptionKey ? `***${subscriptionKey.slice(-4)}` : "None"
      );

      const ssml = `
                <speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis'>
                    <voice name='${voiceName}'>${cleanText}</voice>
                </speak>
            `;

      console.log("🌐 Making request to:", this.endpoint);
      console.log("📝 SSML length:", ssml.length);
      console.log("🎤 Voice:", voiceName);
      console.log("🔊 Format:", outputFormat);
      console.log("🔊 SSML:", ssml);

      const response = await axios.post(this.endpoint, ssml, {
        headers: {
          // Use Bearer token for APIM authentication
          // Authorization: `Bearer ${token}`,
           "Ocp-Apim-Subscription-Key": config.azure.speech.subscriptionKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": outputFormat, // Use dynamic format
          // Header for APIM resource key
          // "x-tts-resource-key":
          //   "aad#/subscriptions/237d30d3-783d-4010-839f-04a544d9fee3/resourceGroups/dev-bu-aidigassist-rg/providers/Microsoft.CognitiveServices/accounts/dev-buaidigassist-speechservice-eastus2#",
        },
        responseType: "arraybuffer",
        validateStatus: () => true, // Don't throw on HTTP errors
      });

      console.log("📡 Response status:", response.status);
      console.log("📡 Response headers:", response.headers);

      if (response.status === 200) {
        const audioData = response.data;
        console.log(`✅ TTS Success: ${audioData.byteLength} bytes`);

        logger.end({
          audioBytes: audioData.byteLength,
          statusCode: response.status,
        });

        // Check if audio data is actually present
        if (!audioData || audioData.byteLength === 0) {
          console.warn(
            `⚠️  Warning: Received 0 bytes of audio data with format: ${outputFormat}`
          );
          throw new Error(
            `No audio data received. Format '${outputFormat}' may not be supported by this endpoint.`
          );
        }

        // Create PassThrough stream and return it
        const bufferStream = new PassThrough();
        bufferStream.end(Buffer.from(audioData));

        return bufferStream;
      } else {
        console.log(`❌ TTS Failed: HTTP ${response.status}`);
        console.log("❌ Response data:", response.data.toString());
        if (response.status === 401) {
          throw new Error("Authentication failed - check token");
        }
        if (response.status === 404) {
          throw new Error(`Endpoint not found: ${this.endpoint}`);
        }
        throw new Error(`TTS failed with status ${response.status}`);
      }
    } catch (error) {
      logger.error(error);
      console.error("TTS Error:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", error.response.data);
      }
      throw error;
    }
  }
}

module.exports = new AzureTTSService();
