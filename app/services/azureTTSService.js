const axios = require("axios");
const { config } = require("../config/config");
const azureAuthService = require("./azureAuthService");
const { PassThrough } = require("stream");
const { createPerformanceLogger } = require("../utils/performanceLogger");
const voiceInstance = require("../config/voiceInstance");
const {
  TTS_FORMATS,
  VoiceConfigError,
  VoiceUpstreamError,
  buildSsml,
  mapUpstreamStatus,
  stripUneeqTags,
} = voiceInstance;

/**
 * Voice output — Azure text-to-speech.
 *
 * The endpoint comes from config/voiceInstance.js rather than being hard-coded
 * here, so this service moves with the resource when the app is repointed.
 */
class AzureTTSService {
  constructor() {
    // Injectable so tests can drive this without reaching the network.
    this.httpClient = axios;
  }

  /** Current endpoint, read live so a voiceInstance.reload() takes effect. */
  get endpoint() {
    return voiceInstance.voice.ttsUrl;
  }

  stripUneeqTags(text) {
    return stripUneeqTags(text);
  }

  /** Auth header set for the resolved instance. */
  async authHeaders() {
    const v = voiceInstance.voice;
    if (v.authMode === "bearer") {
      const token = await azureAuthService.getAccessToken();
      if (!token) throw new VoiceConfigError("Could not acquire an AAD token for voice output");
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
   * Synthesize text (or caller-supplied SSML) to audio.
   *
   * Returns a Buffer plus the metadata the route needs. The legacy
   * textToSpeech() below wraps this in a stream for existing callers.
   *
   * @param {string} text
   * @param {object} opts { voice, format, rate, pitch, style, lang, ssml }
   */
  async synthesize(text, opts = {}) {
    const v = voiceInstance.voice;
    const formatName = (opts.format || v.defaultFormat).toLowerCase();
    const fmt = TTS_FORMATS[formatName];

    if (!fmt) {
      throw new VoiceUpstreamError(
        `Unsupported format '${formatName}' — expected one of ${Object.keys(TTS_FORMATS).join(", ")}`,
        400,
      );
    }

    const voiceName = opts.voice || v.voice;
    const logger = createPerformanceLogger("Azure TTS");
    logger.start("Text-to-Speech Conversion", {
      voice: voiceName,
      format: formatName,
      textLength: text?.length || 0,
      endpoint: this.endpoint,
    });

    try {
      let payload;
      if (opts.ssml) {
        // Caller-supplied SSML passes through untouched — they own the markup.
        payload = opts.ssml;
      } else {
        const clean = stripUneeqTags(text);
        if (!clean) throw new VoiceUpstreamError("No text to synthesize", 400);
        if (clean.length > v.maxTtsChars) {
          throw new VoiceUpstreamError(`Text exceeds ${v.maxTtsChars} characters`, 413);
        }
        // Text is XML-escaped inside buildSsml, so it cannot inject markup.
        payload = buildSsml(clean, voiceName, {
          rate: opts.rate || "",
          pitch: opts.pitch || "",
          style: opts.style || "",
          lang: opts.lang || "en-US",
        });
      }

      const headers = {
        ...(await this.authHeaders()),
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": fmt.azure,
        "User-Agent": "uneeq-poc-voice-api",
      };
      if (v.ttsResourceKey) headers["x-tts-resource-key"] = v.ttsResourceKey;

      const response = await this.httpClient.post(this.endpoint, payload, {
        headers,
        responseType: "arraybuffer",
        timeout: v.timeoutMs,
        // Inspect the status ourselves so upstream errors are mapped, not thrown
        // as opaque axios errors.
        validateStatus: () => true,
      });

      if (response.status >= 400) {
        // Log the upstream body for diagnosis; never return it verbatim.
        console.error(
          `[voice] TTS upstream ${response.status}:`,
          Buffer.from(response.data || "").toString("utf8").slice(0, 500),
        );
        logger.error({ statusCode: response.status });
        throw new VoiceUpstreamError(
          `Text-to-speech upstream returned ${response.status}`,
          mapUpstreamStatus(response.status),
          response.status,
        );
      }

      const audio = Buffer.from(response.data || []);
      if (audio.length === 0) {
        throw new VoiceUpstreamError(
          `Synthesis returned no audio — format '${formatName}' may not be supported by this endpoint`,
          502,
        );
      }

      logger.end({ audioBytes: audio.length, statusCode: response.status });

      return {
        audio,
        contentType: fmt.contentType,
        azureFormat: fmt.azure,
        format: formatName,
        voice: voiceName,
        bytes: audio.length,
      };
    } catch (error) {
      if (error instanceof VoiceConfigError || error instanceof VoiceUpstreamError) {
        logger.error(error);
        throw error;
      }
      logger.error(error);
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        throw new VoiceUpstreamError("Text-to-speech request timed out", 504);
      }
      if (error.response) {
        console.error(
          `[voice] TTS upstream ${error.response.status}:`,
          Buffer.from(error.response.data || "").toString("utf8").slice(0, 500),
        );
        throw new VoiceUpstreamError(
          `Text-to-speech upstream returned ${error.response.status}`,
          mapUpstreamStatus(error.response.status),
          error.response.status,
        );
      }
      throw new VoiceUpstreamError(`Text-to-speech request failed: ${error.message}`, 502);
    }
  }

  /**
   * Legacy signature, kept so /api/text-to-speech and sdkRoutes keep working.
   * Returns a readable stream, as before.
   *
   * NOTE: the third parameter used to be a caller-supplied Azure subscription
   * key. It is now ignored — see the security note in API_USAGE.md. Keys come
   * from the server's configured voice instance only.
   */
  async textToSpeech(text, voiceName, _ignoredApiKey, outputFormat) {
    // Map a raw Azure format string back to a catalogue name when possible, so
    // existing callers that pass e.g. "riff-16khz-16bit-mono-pcm" still work.
    let format = voiceInstance.voice.defaultFormat;
    if (outputFormat) {
      const match = Object.entries(TTS_FORMATS).find(
        ([name, f]) => name === String(outputFormat).toLowerCase() || f.azure === outputFormat,
      );
      if (match) {
        format = match[0];
      } else {
        throw new VoiceUpstreamError(`Unsupported output format '${outputFormat}'`, 400);
      }
    }

    const result = await this.synthesize(text, { voice: voiceName, format });

    const bufferStream = new PassThrough();
    bufferStream.end(result.audio);
    return bufferStream;
  }
}

module.exports = new AzureTTSService();
module.exports.AzureTTSService = AzureTTSService;
