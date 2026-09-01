const axios = require("axios");
const { config } = require("../config/config");
const azureAuthService = require("./azureAuthService");
const { createPerformanceLogger } = require("../utils/performanceLogger");

class AzureSTTService {
  constructor() {
    // this.endpoint = `https://dev-buaidigassist-speechservice-${config.azure.speech.region}domain.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1`;
    // APIM End point
    // this.endpoint = `https://gateway.apim-dev.lilly.com/bu-aidigassist/stt/speech/recognition/conversation/cognitiveservices/v1`;
    //Azure End point
    this.endpoint='https://eastus2.api.cognitive.microsoft.com/stt/speech/recognition/conversation/cognitiveservices/v1'

  }

  async speechToText(audioBuffer, language = "en-US") {
    const logger = createPerformanceLogger("Azure STT");
    logger.start("Speech-to-Text Conversion", {
      language,
      audioBytes: audioBuffer?.length || 0,
    });
    const startTime = Date.now();
    try {
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
        throw new Error("Audio buffer is required");
      }

      // Get access token from Azure Auth Service
      // const token = await azureAuthService.getAccessToken();

      const response = await axios.post(this.endpoint, audioBuffer, {
        headers: {
          // Authorization: `Bearer ${token}`,
          "Ocp-Apim-Subscription-Key": config.azure.speech.subscriptionKey,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          Accept: "application/json",
        },
        params: {
          language: language,
          format: "detailed",
        },
        timeout: 30000,
      });

      if (response.status === 200) {
        const durationMs = Date.now() - startTime;
        logger.end({
          statusCode: response.status,
          resultType: typeof response.data,
          durationMs,
        });
        return response.data;
      } else {
        logger.error({
          statusCode: response.status,
          responseData: response.data,
        });
        throw new Error(`STT failed with status ${response.status}`);
      }
    } catch (error) {
      logger.error(error);
      console.error("STT Error:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", error.response.data);
      }
      throw error;
    }
  }
}

module.exports = new AzureSTTService();
