const axios = require("axios");
const { config } = require("../config/config");
const azureAuthService = require("./azureAuthService");
const { createPerformanceLogger } = require("../utils/performanceLogger");
const voiceInstance = require("../config/voiceInstance");
const {
  VoiceConfigError,
  VoiceUpstreamError,
  mapUpstreamStatus,
} = voiceInstance;

/**
 * Voice input — Azure speech-to-text.
 *
 * The endpoint is no longer hard-coded here; it comes from config/voiceInstance.js
 * so this service moves with the resource when the app is repointed.
 */
class AzureSTTService {
  constructor() {
    // Injectable so tests can drive this without reaching the network.
    this.httpClient = axios;
  }

  /** Current endpoint, read live so a voiceInstance.reload() takes effect. */
  get endpoint() {
    return voiceInstance.voice.sttUrl;
  }

  /**
   * Normalize Azure's `detailed` recognition payload into a stable shape, so
   * callers don't have to know about RecognitionStatus / DisplayText / NBest.
   */
  static normalize(data, language) {
    if (!data || typeof data !== "object") {
      return { text: "", status: "Unknown", confidence: null, durationMs: 0, language, raw: data };
    }

    const nbest = Array.isArray(data.NBest) ? data.NBest : [];
    const best = nbest.length ? nbest[0] : null;

    return {
      text: (data.DisplayText || best?.Display || best?.Lexical || "").trim(),
      status: data.RecognitionStatus || "Unknown",
      confidence: best && typeof best.Confidence === "number" ? best.Confidence : null,
      // Azure reports offset/duration in 100-nanosecond ticks.
      durationMs: data.Duration ? Math.round(data.Duration / 10000) : 0,
      offsetMs: data.Offset ? Math.round(data.Offset / 10000) : 0,
      language,
      raw: data,
    };
  }

  /** Auth header set for the resolved instance. */
  async authHeaders() {
    const v = voiceInstance.voice;
    if (v.authMode === "bearer") {
      const token = await azureAuthService.getAccessToken();
      if (!token) throw new VoiceConfigError("Could not acquire an AAD token for voice input");
      return { Authorization: `Bearer ${token}` };
    }
    const key = v.key || config.azure.speech.subscriptionKey;
    if (!key) {
      throw new VoiceConfigError(
        "Voice instance not configured — set AZURE_VOICE_KEY (or AZURE_SUBSCRIPTION_KEY)",
      );
    }
    return { "Ocp-Apim-Subscription-Key": key };
  }

  /**
   * Transcribe one audio buffer.
   *
   * @param {Buffer} audioBuffer  raw audio bytes
   * @param {string} language     BCP-47 locale, defaults to the instance locale
   * @param {object} opts         { contentType }
   * @returns {Promise<object>}   normalized result (see normalize())
   */
  async speechToText(audioBuffer, language, opts = {}) {
    const v = voiceInstance.voice;
    const lang = language || v.locale;
    const logger = createPerformanceLogger("Azure STT");
    logger.start("Speech-to-Text Conversion", {
      language: lang,
      audioBytes: audioBuffer?.length || 0,
      endpoint: this.endpoint,
    });

    try {
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
        throw new VoiceUpstreamError("Audio buffer is required", 400);
      }
      if (audioBuffer.length === 0) {
        throw new VoiceUpstreamError("Audio buffer is empty", 400);
      }
      if (audioBuffer.length > v.maxAudioBytes) {
        throw new VoiceUpstreamError(
          `Audio exceeds ${v.maxAudioBytes} bytes`,
          413,
        );
      }

      const headers = {
        ...(await this.authHeaders()),
        "Content-Type":
          opts.contentType || "audio/wav; codecs=audio/pcm; samplerate=16000",
        Accept: "application/json",
      };

      const response = await this.httpClient.post(this.endpoint, audioBuffer, {
        headers,
        params: { language: lang, format: "detailed" },
        timeout: v.timeoutMs,
        // Inspect the status ourselves so upstream errors are mapped, not thrown
        // as opaque axios errors.
        validateStatus: () => true,
      });

      if (response.status >= 400) {
        // Log the upstream body for diagnosis; never return it verbatim, since
        // Azure error payloads can echo request detail back.
        console.error(
          `[voice] STT upstream ${response.status}:`,
          String(response.data).slice(0, 500),
        );
        logger.error({ statusCode: response.status });
        throw new VoiceUpstreamError(
          `Speech-to-text upstream returned ${response.status}`,
          mapUpstreamStatus(response.status),
          response.status,
        );
      }

      const result = AzureSTTService.normalize(response.data, lang);
      logger.end({ statusCode: response.status, chars: result.text.length });
      return result;
    } catch (error) {
      if (error instanceof VoiceConfigError || error instanceof VoiceUpstreamError) {
        logger.error(error);
        throw error;
      }
      logger.error(error);
      // Map transport-level failures rather than leaking an axios error object.
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        throw new VoiceUpstreamError("Speech-to-text request timed out", 504);
      }
      if (error.response) {
        console.error(
          `[voice] STT upstream ${error.response.status}:`,
          String(error.response.data).slice(0, 500),
        );
        throw new VoiceUpstreamError(
          `Speech-to-text upstream returned ${error.response.status}`,
          mapUpstreamStatus(error.response.status),
          error.response.status,
        );
      }
      throw new VoiceUpstreamError(`Speech-to-text request failed: ${error.message}`, 502);
    }
  }
}

module.exports = new AzureSTTService();
module.exports.AzureSTTService = AzureSTTService;
