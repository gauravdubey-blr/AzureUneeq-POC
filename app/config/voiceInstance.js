/**
 * Voice instance configuration.
 *
 * Single source of truth for *which* Azure resource serves voice input (STT)
 * and voice output (TTS). Both azureSTTService and azureTTSService read from
 * here instead of hard-coding a host in their constructors, so repointing the
 * app at a new Azure resource is a config change, not a code change.
 *
 * Endpoint modes — pick with AZURE_VOICE_MODE:
 *
 *   cognitive  (default, preserves the previously hard-coded behaviour)
 *     STT  https://{region}.api.cognitive.microsoft.com/stt/speech/recognition/conversation/cognitiveservices/v1
 *     TTS  https://{region}.api.cognitive.microsoft.com/tts/cognitiveservices/v1
 *
 *   speech     (Microsoft's standard per-service hosts)
 *     STT  https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
 *     TTS  https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 *
 *   apim       (Lilly APIM gateway — set AZURE_VOICE_BASE_URL to the gateway base)
 *     STT  {base}/stt/speech/recognition/conversation/cognitiveservices/v1
 *     TTS  {base}/tts/cognitiveservices/v1
 *
 * AZURE_VOICE_STT_URL / AZURE_VOICE_TTS_URL override the derived URL outright,
 * for private endpoints or any shape the modes above don't cover.
 *
 * Every setting falls back to the legacy variable it replaces, so an existing
 * deployment keeps working with none of the new vars set.
 */

require("dotenv").config();

/** First non-empty value among the given env var names. */
function firstSet(names, fallback = "") {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  return fallback;
}

function stripTrailingSlash(u) {
  return u ? u.replace(/\/+$/, "") : u;
}

// ─── Output format catalogue ─────────────────────────────────────────────────
// Maps the short name a REST caller passes to the Azure output format plus the
// HTTP content type we hand back. These are the only values /voice/speak takes.
const TTS_FORMATS = {
  pcm16: { azure: "riff-16khz-16bit-mono-pcm", contentType: "audio/wav" },
  pcm24: { azure: "riff-24khz-16bit-mono-pcm", contentType: "audio/wav" },
  wav: { azure: "riff-24khz-16bit-mono-pcm", contentType: "audio/wav" },
  mp3: { azure: "audio-24khz-48kbitrate-mono-mp3", contentType: "audio/mpeg" },
  mp3hq: { azure: "audio-48khz-192kbitrate-mono-mp3", contentType: "audio/mpeg" },
  // Raw PCM16 with no RIFF header — what the UneeQ/browser player path feeds
  // straight into an AudioContext.
  raw24: { azure: "raw-24khz-16bit-mono-pcm", contentType: "audio/L16; rate=24000" },
};

// The legacy /api/text-to-speech route used 16 kHz RIFF PCM; keep that as the
// default so existing clients get byte-identical audio.
const DEFAULT_TTS_FORMAT = "pcm16";

// Audio container types accepted on voice input.
const ALLOWED_STT_MIME = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "application/octet-stream",
]);

const MODES = {
  cognitive: {
    stt: (r) =>
      `https://${r}.api.cognitive.microsoft.com/stt/speech/recognition/conversation/cognitiveservices/v1`,
    tts: (r) => `https://${r}.api.cognitive.microsoft.com/tts/cognitiveservices/v1`,
  },
  speech: {
    stt: (r) =>
      `https://${r}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
    tts: (r) => `https://${r}.tts.speech.microsoft.com/cognitiveservices/v1`,
  },
  live: {
    stt: (_r, base) =>
      `${base}/stt/speech/recognition/conversation/cognitiveservices/v1`,
    tts: (_r, base) => `${base}/tts/cognitiveservices/v1`,
  },
};

/**
 * Build the resolved voice instance from the environment.
 * Called at import and re-callable from tests via reload().
 */
function load() {
  const region = firstSet(["AZURE_VOICE_REGION", "AZURE_SPEECH_REGION"], "eastus2");
  const liveEndpoint = stripTrailingSlash(firstSet(["AZURE_VOICE_LIVE_ENDPOINT"]));
  const key = firstSet([
    "AZURE_VOICE_KEY",
    "AZURE_VOICE_LIVE_KEY",
    "AZURE_SUBSCRIPTION_KEY", // legacy name used by config.azure.speech.subscriptionKey
    "AZURE_SPEECH_KEY",
  ]);
  const mode = firstSet(["AZURE_VOICE_MODE"], liveEndpoint ? "live" : "cognitive").toLowerCase();
  const baseUrl = stripTrailingSlash(firstSet(["AZURE_VOICE_BASE_URL"]));

  const warnings = [];

  let sttUrl = stripTrailingSlash(firstSet(["AZURE_VOICE_STT_URL"]));
  let ttsUrl = stripTrailingSlash(firstSet(["AZURE_VOICE_TTS_URL"]));

  if (!sttUrl || !ttsUrl) {
    if (mode === "live") {
      if (!liveEndpoint) {
        warnings.push(
          "AZURE_VOICE_MODE=live but AZURE_VOICE_LIVE_ENDPOINT is not set — falling back to 'cognitive' mode",
        );
        sttUrl = sttUrl || MODES.cognitive.stt(region);
        ttsUrl = ttsUrl || MODES.cognitive.tts(region);
      } else {
        sttUrl = sttUrl || MODES.live.stt(region, liveEndpoint);
        ttsUrl = ttsUrl || MODES.live.tts(region, liveEndpoint);
      }
    } else if (mode === "apim") {
      if (!baseUrl) {
        warnings.push(
          "AZURE_VOICE_MODE=apim but AZURE_VOICE_BASE_URL is not set — falling back to 'cognitive' mode",
        );
        sttUrl = sttUrl || MODES.cognitive.stt(region);
        ttsUrl = ttsUrl || MODES.cognitive.tts(region);
      } else {
        sttUrl =
          sttUrl ||
          `${baseUrl}/stt/speech/recognition/conversation/cognitiveservices/v1`;
        ttsUrl = ttsUrl || `${baseUrl}/tts/cognitiveservices/v1`;
      }
    } else {
      const m = MODES[mode] || MODES.cognitive;
      if (!MODES[mode]) {
        warnings.push(
          `Unknown AZURE_VOICE_MODE='${mode}' — expected live|cognitive|speech|apim; using 'cognitive'`,
        );
      }
      sttUrl = sttUrl || m.stt(region);
      ttsUrl = ttsUrl || m.tts(region);
    }
  }

  const instance = {
    region,
    key,
    mode,
    baseUrl,
    sttUrl,
    ttsUrl,

    locale: firstSet(["AZURE_VOICE_STT_LOCALE"], "en-US"),
    voice: firstSet(
      ["VOICELIVE_VOICE", "AZURE_VOICE_TTS_VOICE", "AZURE_VOICE_NAME"],
      "en-US-AriaNeural",
    ),
    defaultFormat: firstSet(["AZURE_VOICE_TTS_FORMAT"], DEFAULT_TTS_FORMAT),

    // Caps — stop one request buffering unbounded audio or holding a synthesis
    // connection open for minutes on a runaway LLM answer.
    maxAudioBytes: Number(process.env.VOICE_MAX_AUDIO_BYTES || 25 * 1024 * 1024),
    maxTtsChars: Number(process.env.VOICE_MAX_TTS_CHARS || 5000),
    timeoutMs: Number(process.env.VOICE_TIMEOUT_MS || 30000),

    // Auth style. 'key' sends Ocp-Apim-Subscription-Key (default).
    // 'bearer' sends an AAD token from azureAuthService — used when the request
    // goes through APIM rather than straight to the Speech resource.
    authMode: firstSet(["AZURE_VOICE_AUTH_MODE"], "key").toLowerCase(),

    // APIM deployments needed this header to route to the backing resource.
    ttsResourceKey: firstSet(["AZURE_VOICE_TTS_RESOURCE_KEY"]),

    warnings,
  };

  if (!instance.key && instance.authMode === "key") {
    instance.warnings.push(
      "No voice key resolved (AZURE_VOICE_KEY / AZURE_SUBSCRIPTION_KEY) — voice input and output will return 503",
    );
  }
  if (!TTS_FORMATS[instance.defaultFormat]) {
    instance.warnings.push(
      `AZURE_VOICE_TTS_FORMAT='${instance.defaultFormat}' is not a known format — using '${DEFAULT_TTS_FORMAT}'`,
    );
    instance.defaultFormat = DEFAULT_TTS_FORMAT;
  }

  return instance;
}

let VOICE = load();

/** Re-read the environment into the singleton. Used by tests. */
function reload() {
  VOICE = load();
  return VOICE;
}

function current() {
  return VOICE;
}

/** True when voice input/output has what it needs to make a call. */
function isReady() {
  return Boolean((VOICE.key || VOICE.authMode === "bearer") && VOICE.sttUrl && VOICE.ttsUrl);
}

/** Non-secret view, safe to return from /health and /api/voice/config. */
function publicView() {
  return {
    region: VOICE.region,
    mode: VOICE.mode,
    sttUrl: VOICE.sttUrl,
    ttsUrl: VOICE.ttsUrl,
    locale: VOICE.locale,
    voice: VOICE.voice,
    defaultFormat: VOICE.defaultFormat,
    authMode: VOICE.authMode,
    formats: Object.keys(TTS_FORMATS),
    maxAudioBytes: VOICE.maxAudioBytes,
    maxTtsChars: VOICE.maxTtsChars,
    ready: isReady(),
    keyConfigured: Boolean(VOICE.key),
  };
}

// ─── SSML ────────────────────────────────────────────────────────────────────

/** Escape text for inclusion in XML character data or an attribute value. */
function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Strip UneeQ control tags (<uneeq-*>) before the text reaches synthesis. */
function stripUneeqTags(text) {
  if (!text) return "";
  return String(text).replace(/<uneeq-[^>]*>/g, "").trim();
}

/**
 * Wrap plain text in SSML.
 *
 * The text is XML-escaped, so response content cannot inject markup or extra
 * <voice> elements into the document we send to Azure.
 */
function buildSsml(text, voiceName, opts = {}) {
  const { rate = "", pitch = "", lang = "en-US", style = "" } = opts;
  let body = escapeXml(text);

  if (rate || pitch) {
    const attrs = [
      rate ? ` rate="${escapeXml(rate)}"` : "",
      pitch ? ` pitch="${escapeXml(pitch)}"` : "",
    ].join("");
    body = `<prosody${attrs}>${body}</prosody>`;
  }

  if (style) {
    body = `<mstts:express-as style="${escapeXml(style)}">${body}</mstts:express-as>`;
  }

  const nsMstts = style
    ? ' xmlns:mstts="http://www.w3.org/2001/mstts"'
    : "";

  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"${nsMstts}` +
    ` xml:lang="${escapeXml(lang)}">` +
    `<voice name="${escapeXml(voiceName)}">${body}</voice>` +
    `</speak>`
  );
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Voice instance is not configured — surfaces as HTTP 503. */
class VoiceConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "VoiceConfigError";
    this.statusCode = 503;
  }
}

/** Azure returned a non-2xx, or the request itself failed. */
class VoiceUpstreamError extends Error {
  constructor(message, statusCode = 502, upstreamStatus = 0) {
    super(message);
    this.name = "VoiceUpstreamError";
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
  }
}

/**
 * Translate an Azure status into the status this API should return.
 *
 * 401/403 becomes 502 on purpose: a bad server-side key is not the caller's
 * authorization problem, and returning 401 makes clients retry auth pointlessly.
 */
function mapUpstreamStatus(status) {
  if (status === 401 || status === 403) return 502;
  if (status === 429) return 429; // pass through so callers can back off
  if (status === 400) return 400; // bad audio / bad SSML is the caller's problem
  if (status === 408 || status === 504) return 504;
  return 502;
}

module.exports = {
  TTS_FORMATS,
  DEFAULT_TTS_FORMAT,
  ALLOWED_STT_MIME,
  VoiceConfigError,
  VoiceUpstreamError,
  buildSsml,
  current,
  escapeXml,
  isReady,
  load,
  mapUpstreamStatus,
  publicView,
  reload,
  stripUneeqTags,
  get voice() {
    return VOICE;
  },
};
