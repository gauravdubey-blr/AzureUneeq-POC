/**
 * Tests for config/voiceInstance.js — endpoint resolution, format catalogue,
 * SSML escaping and upstream status mapping.
 *
 * Uses Node's built-in test runner, so there are no new dependencies:
 *   node --test test/
 */

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const vi = require("../config/voiceInstance");

const VOICE_ENV = [
  "AZURE_VOICE_REGION",
  "AZURE_VOICE_KEY",
  "AZURE_VOICE_MODE",
  "AZURE_VOICE_BASE_URL",
  "AZURE_VOICE_STT_URL",
  "AZURE_VOICE_TTS_URL",
  "AZURE_VOICE_STT_LOCALE",
  "AZURE_VOICE_TTS_VOICE",
  "AZURE_VOICE_TTS_FORMAT",
  "AZURE_VOICE_AUTH_MODE",
  "AZURE_SUBSCRIPTION_KEY",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_KEY",
];

let saved = {};

beforeEach(() => {
  saved = {};
  for (const k of VOICE_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of VOICE_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.reload();
});

describe("endpoint resolution", () => {
  test("defaults preserve the previously hard-coded endpoints", () => {
    const v = vi.reload();
    assert.equal(
      v.sttUrl,
      "https://eastus2.api.cognitive.microsoft.com/stt/speech/recognition/conversation/cognitiveservices/v1",
    );
    assert.equal(
      v.ttsUrl,
      "https://eastus2.api.cognitive.microsoft.com/tts/cognitiveservices/v1",
    );
    assert.equal(v.mode, "cognitive");
    assert.equal(v.region, "eastus2");
  });

  test("region change repoints both directions", () => {
    process.env.AZURE_VOICE_REGION = "westeurope";
    const v = vi.reload();
    assert.ok(v.sttUrl.includes("westeurope"));
    assert.ok(v.ttsUrl.includes("westeurope"));
  });

  test("speech mode uses Microsoft's per-service hosts", () => {
    process.env.AZURE_VOICE_MODE = "speech";
    process.env.AZURE_VOICE_REGION = "eastus2";
    const v = vi.reload();
    assert.equal(
      v.sttUrl,
      "https://eastus2.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
    );
    assert.equal(
      v.ttsUrl,
      "https://eastus2.tts.speech.microsoft.com/cognitiveservices/v1",
    );
  });

  test("apim mode builds from the gateway base", () => {
    process.env.AZURE_VOICE_MODE = "apim";
    process.env.AZURE_VOICE_BASE_URL = "https://gateway.apim-dev.lilly.com/bu-aidigassist/";
    const v = vi.reload();
    assert.equal(
      v.sttUrl,
      "https://gateway.apim-dev.lilly.com/bu-aidigassist/stt/speech/recognition/conversation/cognitiveservices/v1",
    );
    assert.equal(
      v.ttsUrl,
      "https://gateway.apim-dev.lilly.com/bu-aidigassist/tts/cognitiveservices/v1",
    );
  });

  test("apim mode without a base URL warns and falls back", () => {
    process.env.AZURE_VOICE_MODE = "apim";
    const v = vi.reload();
    assert.ok(v.warnings.some((w) => w.includes("AZURE_VOICE_BASE_URL")));
    assert.ok(v.sttUrl.includes("api.cognitive.microsoft.com"));
  });

  test("unknown mode warns and falls back to cognitive", () => {
    process.env.AZURE_VOICE_MODE = "banana";
    const v = vi.reload();
    assert.ok(v.warnings.some((w) => w.includes("Unknown AZURE_VOICE_MODE")));
    assert.ok(v.sttUrl.includes("api.cognitive.microsoft.com"));
  });

  test("explicit URL overrides win over mode and region", () => {
    process.env.AZURE_VOICE_MODE = "speech";
    process.env.AZURE_VOICE_REGION = "eastus2";
    process.env.AZURE_VOICE_STT_URL = "https://private.example.com/stt/v1/";
    process.env.AZURE_VOICE_TTS_URL = "https://private.example.com/tts/v1/";
    const v = vi.reload();
    assert.equal(v.sttUrl, "https://private.example.com/stt/v1");
    assert.equal(v.ttsUrl, "https://private.example.com/tts/v1");
  });
});

describe("credential resolution", () => {
  test("prefers AZURE_VOICE_KEY", () => {
    process.env.AZURE_VOICE_KEY = "new-key";
    process.env.AZURE_SUBSCRIPTION_KEY = "legacy-key";
    assert.equal(vi.reload().key, "new-key");
  });

  test("falls back to the legacy AZURE_SUBSCRIPTION_KEY", () => {
    process.env.AZURE_SUBSCRIPTION_KEY = "legacy-key";
    assert.equal(vi.reload().key, "legacy-key");
  });

  test("falls back to AZURE_SPEECH_REGION for region", () => {
    process.env.AZURE_SPEECH_REGION = "northeurope";
    assert.equal(vi.reload().region, "northeurope");
  });

  test("warns and is not ready without a key in key auth mode", () => {
    const v = vi.reload();
    assert.equal(v.key, "");
    assert.equal(vi.isReady(), false);
    assert.ok(v.warnings.some((w) => w.includes("No voice key resolved")));
  });

  test("bearer auth mode is ready without a key", () => {
    process.env.AZURE_VOICE_AUTH_MODE = "bearer";
    vi.reload();
    assert.equal(vi.isReady(), true);
  });

  test("publicView never exposes the key", () => {
    process.env.AZURE_VOICE_KEY = "super-secret-key";
    vi.reload();
    const json = JSON.stringify(vi.publicView());
    assert.ok(!json.includes("super-secret-key"));
    assert.equal(vi.publicView().keyConfigured, true);
  });
});

describe("format catalogue", () => {
  test("default format is the legacy 16 kHz RIFF PCM", () => {
    const v = vi.reload();
    assert.equal(v.defaultFormat, "pcm16");
    assert.equal(vi.TTS_FORMATS.pcm16.azure, "riff-16khz-16bit-mono-pcm");
  });

  test("every format has an azure name and an HTTP content type", () => {
    for (const [name, f] of Object.entries(vi.TTS_FORMATS)) {
      assert.ok(f.azure, `${name} missing azure format`);
      assert.ok(f.contentType, `${name} missing contentType`);
    }
  });

  test("an unknown configured default warns and reverts", () => {
    process.env.AZURE_VOICE_TTS_FORMAT = "8-track";
    const v = vi.reload();
    assert.equal(v.defaultFormat, "pcm16");
    assert.ok(v.warnings.some((w) => w.includes("not a known format")));
  });
});

describe("SSML", () => {
  test("escapes ampersands and angle brackets", () => {
    const ssml = vi.buildSsml("SURPASS-1 & SURMOUNT-2 <trials>", "en-US-AriaNeural");
    assert.ok(ssml.includes("&amp;"));
    assert.ok(ssml.includes("&lt;trials&gt;"));
    assert.ok(!/ & /.test(ssml));
  });

  test("text cannot inject a second voice element", () => {
    const nasty = '5 mg</voice><voice name="evil">pwned</voice><voice name="x">';
    const ssml = vi.buildSsml(nasty, "en-US-AriaNeural");
    const voiceOpenTags = ssml.match(/<voice name=/g) || [];
    assert.equal(voiceOpenTags.length, 1);
    assert.ok(!ssml.includes('<voice name="evil">'));
    assert.ok(ssml.includes("&lt;/voice&gt;"));
  });

  test("quotes in the voice name cannot break out of the attribute", () => {
    const ssml = vi.buildSsml("hi", 'en-US-Aria"/><voice name="evil');
    const voiceOpenTags = ssml.match(/<voice name=/g) || [];
    assert.equal(voiceOpenTags.length, 1);
    assert.ok(ssml.includes("&quot;"));
  });

  test("prosody is applied when rate or pitch is given", () => {
    const ssml = vi.buildSsml("slow", "v", { rate: "-10%", pitch: "+2st" });
    assert.ok(ssml.includes('rate="-10%"'));
    assert.ok(ssml.includes('pitch="+2st"'));
  });

  test("no prosody element when neither rate nor pitch is given", () => {
    assert.ok(!vi.buildSsml("plain", "v").includes("<prosody"));
  });

  test("express-as style adds the mstts namespace", () => {
    const ssml = vi.buildSsml("hi", "v", { style: "friendly" });
    assert.ok(ssml.includes('xmlns:mstts="http://www.w3.org/2001/mstts"'));
    assert.ok(ssml.includes('style="friendly"'));
  });

  test("uneeq control tags are stripped", () => {
    assert.equal(
      vi.stripUneeqTags("<uneeq-expression name='smile'>Hello there"),
      "Hello there",
    );
  });
});

describe("upstream status mapping", () => {
  test("our bad key becomes 502, not 401", () => {
    assert.equal(vi.mapUpstreamStatus(401), 502);
    assert.equal(vi.mapUpstreamStatus(403), 502);
  });

  test("rate limiting passes through so callers can back off", () => {
    assert.equal(vi.mapUpstreamStatus(429), 429);
  });

  test("bad request stays the caller's problem", () => {
    assert.equal(vi.mapUpstreamStatus(400), 400);
  });

  test("timeouts map to 504", () => {
    assert.equal(vi.mapUpstreamStatus(408), 504);
    assert.equal(vi.mapUpstreamStatus(504), 504);
  });

  test("anything else is a 502", () => {
    assert.equal(vi.mapUpstreamStatus(500), 502);
    assert.equal(vi.mapUpstreamStatus(503), 502);
  });
});
