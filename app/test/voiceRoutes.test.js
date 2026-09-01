/**
 * Tests for the voice services and the REST voice routes.
 *
 * Azure is never contacted: each service exposes an injectable `httpClient`,
 * and the route handlers are invoked directly with fake req/res objects. No new
 * dependencies — Node's built-in test runner only:
 *   node --test test/
 */

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.AZURE_VOICE_KEY = process.env.AZURE_VOICE_KEY || "test-key-123";

const vi = require("../config/voiceInstance");
vi.reload();

const sttService = require("../services/azureSTTService");
const ttsService = require("../services/azureTTSService");
const voiceRoutes = require("../routes/voiceRoutes");
const speechRoutes = require("../routes/speechRoutes");

const AZURE_DETAILED = {
  RecognitionStatus: "Success",
  DisplayText: "What is the starting dose of Mounjaro?",
  Offset: 1000000,
  Duration: 21000000,
  NBest: [{ Confidence: 0.93, Display: "What is the starting dose of Mounjaro?" }],
};

/** Records what was sent, returns a canned response. */
function fakeHttp(responder) {
  const calls = [];
  return {
    calls,
    post: async (url, data, cfg) => {
      calls.push({ url, data, cfg });
      return responder(url, data, cfg);
    },
  };
}

const okStt = () => ({ status: 200, data: AZURE_DETAILED, headers: {} });
const okTts = () => ({ status: 200, data: Buffer.from("FAKEAUDIOBYTES"), headers: {} });

/**
 * res double. It is a real Writable so the legacy routes' `audioStream.pipe(res)`
 * works, while still capturing status/json/headers like an express response.
 */
const { Writable } = require("node:stream");

function fakeRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.sent = undefined;
  res.headersSent = false;
  res.piped = () => Buffer.concat(chunks);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; res.headersSent = true; return res; };
  res.set = (h) => { Object.assign(res.headers, h); return res; };
  res.send = (b) => { res.sent = b; res.headersSent = true; return res; };
  return res;
}

/** Invoke a route's middleware chain in order. */
async function invoke(router, method, path, req) {
  const route = router.__find(method, path);
  assert.ok(route, `route ${method.toUpperCase()} ${path} not registered`);
  const res = fakeRes();
  for (const handler of route.handlers) {
    let advanced = false;
    await handler(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

const audioFile = (over = {}) => ({
  buffer: Buffer.from("RIFFfakewavdata"),
  originalname: "turn.wav",
  mimetype: "audio/wav",
  size: 15,
  ...over,
});

beforeEach(() => {
  vi.reload();
  sttService.httpClient = fakeHttp(okStt);
  ttsService.httpClient = fakeHttp(okTts);
});

// ─── STT service ─────────────────────────────────────────────────────────────
describe("azureSTTService", () => {
  test("normalizes Azure's detailed payload", async () => {
    const r = await sttService.speechToText(Buffer.from("RIFFxx"), "en-US");
    assert.equal(r.text, "What is the starting dose of Mounjaro?");
    assert.equal(r.status, "Success");
    assert.equal(r.confidence, 0.93);
    assert.equal(r.durationMs, 2100); // 21000000 ticks / 10000
    assert.equal(r.offsetMs, 100);
  });

  test("sends the subscription key and the resolved endpoint", async () => {
    await sttService.speechToText(Buffer.from("RIFFxx"));
    const call = sttService.httpClient.calls[0];
    assert.equal(call.url, vi.voice.sttUrl);
    assert.equal(call.cfg.headers["Ocp-Apim-Subscription-Key"], "test-key-123");
    assert.equal(call.cfg.params.format, "detailed");
  });

  test("uses the instance locale when none is given", async () => {
    process.env.AZURE_VOICE_STT_LOCALE = "fr-FR";
    vi.reload();
    await sttService.speechToText(Buffer.from("RIFFxx"));
    assert.equal(sttService.httpClient.calls[0].cfg.params.language, "fr-FR");
    delete process.env.AZURE_VOICE_STT_LOCALE;
    vi.reload();
  });

  test("rejects a non-buffer payload with 400", async () => {
    await assert.rejects(() => sttService.speechToText("not a buffer"), (e) => {
      assert.equal(e.statusCode, 400);
      return true;
    });
  });

  test("rejects empty audio with 400", async () => {
    await assert.rejects(() => sttService.speechToText(Buffer.alloc(0)), (e) => {
      assert.equal(e.statusCode, 400);
      return true;
    });
  });

  test("rejects oversized audio with 413", async () => {
    const big = Buffer.alloc(vi.voice.maxAudioBytes + 1);
    await assert.rejects(() => sttService.speechToText(big), (e) => {
      assert.equal(e.statusCode, 413);
      return true;
    });
  });

  test("maps an upstream 429 straight through", async () => {
    sttService.httpClient = fakeHttp(() => ({ status: 429, data: "slow down" }));
    await assert.rejects(() => sttService.speechToText(Buffer.from("x")), (e) => {
      assert.equal(e.statusCode, 429);
      assert.ok(!e.message.includes("slow down"));
      return true;
    });
  });

  test("masks an upstream 401 as 502", async () => {
    sttService.httpClient = fakeHttp(() => ({ status: 401, data: "bad key" }));
    await assert.rejects(() => sttService.speechToText(Buffer.from("x")), (e) => {
      assert.equal(e.statusCode, 502);
      return true;
    });
  });

  test("throws VoiceConfigError with no key configured", async () => {
    delete process.env.AZURE_VOICE_KEY;
    const { config } = require("../config/config");
    const savedCfgKey = config.azure.speech.subscriptionKey;
    config.azure.speech.subscriptionKey = undefined;
    vi.reload();
    await assert.rejects(() => sttService.speechToText(Buffer.from("x")), (e) => {
      assert.equal(e.name, "VoiceConfigError");
      assert.equal(e.statusCode, 503);
      return true;
    });
    process.env.AZURE_VOICE_KEY = "test-key-123";
    config.azure.speech.subscriptionKey = savedCfgKey;
    vi.reload();
  });
});

// ─── TTS service ─────────────────────────────────────────────────────────────
describe("azureTTSService", () => {
  test("returns audio with the mapped content type", async () => {
    const r = await ttsService.synthesize("The dose is 2.5 mg.", { format: "mp3" });
    assert.equal(r.contentType, "audio/mpeg");
    assert.equal(r.azureFormat, "audio-24khz-48kbitrate-mono-mp3");
    assert.ok(Buffer.isBuffer(r.audio));
    assert.equal(r.bytes, 14);
  });

  test("sends escaped SSML to the resolved endpoint", async () => {
    await ttsService.synthesize("SURPASS-1 & <b>bold</b>");
    const call = ttsService.httpClient.calls[0];
    assert.equal(call.url, vi.voice.ttsUrl);
    assert.equal(call.cfg.headers["Content-Type"], "application/ssml+xml");
    assert.ok(call.data.includes("&amp;"));
    assert.ok(call.data.includes("&lt;b&gt;"));
  });

  test("defaults to the legacy 16 kHz PCM format", async () => {
    await ttsService.synthesize("hello");
    assert.equal(
      ttsService.httpClient.calls[0].cfg.headers["X-Microsoft-OutputFormat"],
      "riff-16khz-16bit-mono-pcm",
    );
  });

  test("every catalogue format is accepted and mapped", async () => {
    for (const [name, f] of Object.entries(vi.TTS_FORMATS)) {
      ttsService.httpClient = fakeHttp(okTts);
      const r = await ttsService.synthesize("hi", { format: name });
      assert.equal(r.contentType, f.contentType, name);
      assert.equal(
        ttsService.httpClient.calls[0].cfg.headers["X-Microsoft-OutputFormat"],
        f.azure,
        name,
      );
    }
  });

  test("rejects an unknown format with 400", async () => {
    await assert.rejects(() => ttsService.synthesize("hi", { format: "8-track" }), (e) => {
      assert.equal(e.statusCode, 400);
      return true;
    });
  });

  test("rejects empty text with 400", async () => {
    await assert.rejects(() => ttsService.synthesize("   "), (e) => {
      assert.equal(e.statusCode, 400);
      return true;
    });
  });

  test("rejects text over the cap with 413", async () => {
    const long = "a".repeat(vi.voice.maxTtsChars + 1);
    await assert.rejects(() => ttsService.synthesize(long), (e) => {
      assert.equal(e.statusCode, 413);
      return true;
    });
  });

  test("treats a zero-byte synthesis as an upstream failure", async () => {
    ttsService.httpClient = fakeHttp(() => ({ status: 200, data: Buffer.alloc(0) }));
    await assert.rejects(() => ttsService.synthesize("hi"), (e) => {
      assert.equal(e.statusCode, 502);
      return true;
    });
  });

  test("strips uneeq tags before synthesis", async () => {
    await ttsService.synthesize("<uneeq-expression name='smile'>Hello");
    assert.ok(!ttsService.httpClient.calls[0].data.includes("uneeq-"));
  });

  test("passes caller-supplied SSML through untouched", async () => {
    const raw = '<speak version="1.0"><voice name="v">Hi</voice></speak>';
    await ttsService.synthesize("", { ssml: raw });
    assert.equal(ttsService.httpClient.calls[0].data, raw);
  });

  test("legacy textToSpeech still returns a stream", async () => {
    const stream = await ttsService.textToSpeech("hello", "en-US-AriaNeural", "ignored-key");
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    assert.equal(Buffer.concat(chunks).toString(), "FAKEAUDIOBYTES");
  });

  test("legacy textToSpeech ignores a caller-supplied API key", async () => {
    await ttsService.textToSpeech("hello", "en-US-AriaNeural", "attacker-key");
    assert.equal(
      ttsService.httpClient.calls[0].cfg.headers["Ocp-Apim-Subscription-Key"],
      "test-key-123",
    );
  });

  test("legacy textToSpeech accepts a raw azure format string", async () => {
    await ttsService.textToSpeech("hi", "v", undefined, "riff-16khz-16bit-mono-pcm");
    assert.equal(
      ttsService.httpClient.calls[0].cfg.headers["X-Microsoft-OutputFormat"],
      "riff-16khz-16bit-mono-pcm",
    );
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
describe("POST /api/voice/transcribe", () => {
  test("returns the transcript", async () => {
    const res = await invoke(voiceRoutes, "post", "/transcribe", {
      body: {}, __file: audioFile(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "What is the starting dose of Mounjaro?");
    assert.equal(res.body.confidence, 0.93);
  });

  test("400 when no file is attached", async () => {
    const res = await invoke(voiceRoutes, "post", "/transcribe", { body: {} });
    assert.equal(res.statusCode, 400);
  });

  test("415 on a non-audio content type", async () => {
    const res = await invoke(voiceRoutes, "post", "/transcribe", {
      body: {}, __file: audioFile({ mimetype: "text/plain" }),
    });
    assert.equal(res.statusCode, 415);
  });

  test("413 when the upload exceeds the cap", async () => {
    const res = await invoke(voiceRoutes, "post", "/transcribe", {
      body: {},
      __file: audioFile({ buffer: Buffer.alloc(vi.voice.maxAudioBytes + 1) }),
    });
    assert.equal(res.statusCode, 413);
  });

  test("propagates an upstream 429", async () => {
    sttService.httpClient = fakeHttp(() => ({ status: 429, data: "x" }));
    const res = await invoke(voiceRoutes, "post", "/transcribe", {
      body: {}, __file: audioFile(),
    });
    assert.equal(res.statusCode, 429);
  });
});

describe("POST /api/voice/speak", () => {
  test("returns binary audio by default", async () => {
    const res = await invoke(voiceRoutes, "post", "/speak", { body: { text: "hi" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.sent.toString(), "FAKEAUDIOBYTES");
    assert.equal(res.headers["Content-Type"], "audio/wav");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.ok(res.headers["X-Voice-Name"]);
  });

  test("returns base64 JSON when asked", async () => {
    const res = await invoke(voiceRoutes, "post", "/speak", {
      body: { text: "hi", encoding: "base64" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(
      Buffer.from(res.body.audio, "base64").toString(),
      "FAKEAUDIOBYTES",
    );
    assert.equal(res.body.bytes, 14);
  });

  test("400 with neither text nor ssml", async () => {
    const res = await invoke(voiceRoutes, "post", "/speak", { body: {} });
    assert.equal(res.statusCode, 400);
  });

  test("400 on an unsupported format", async () => {
    const res = await invoke(voiceRoutes, "post", "/speak", {
      body: { text: "hi", format: "8-track" },
    });
    assert.equal(res.statusCode, 400);
  });

  test("400 on an unsupported encoding", async () => {
    const res = await invoke(voiceRoutes, "post", "/speak", {
      body: { text: "hi", encoding: "rot13" },
    });
    assert.equal(res.statusCode, 400);
  });

  test("503 when the instance has no credentials", async () => {
    delete process.env.AZURE_VOICE_KEY;
    const { config } = require("../config/config");
    const savedCfgKey = config.azure.speech.subscriptionKey;
    config.azure.speech.subscriptionKey = undefined;
    vi.reload();
    const res = await invoke(voiceRoutes, "post", "/speak", { body: { text: "hi" } });
    assert.equal(res.statusCode, 503);
    process.env.AZURE_VOICE_KEY = "test-key-123";
    config.azure.speech.subscriptionKey = savedCfgKey;
    vi.reload();
  });
});

describe("GET /api/voice/config", () => {
  test("reports the instance without leaking the key", async () => {
    const res = await invoke(voiceRoutes, "get", "/config", { body: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.voiceInstance.region, "eastus2");
    assert.equal(res.body.endpoints.transcribe, "/api/voice/transcribe");
    assert.ok(!JSON.stringify(res.body).includes("test-key-123"));
  });
});

// ─── Legacy routes still work ────────────────────────────────────────────────
describe("legacy routes", () => {
  test("POST /api/speech-to-text returns both text and raw transcription", async () => {
    const res = await invoke(speechRoutes, "post", "/speech-to-text", {
      body: {}, __file: audioFile(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "What is the starting dose of Mounjaro?");
    assert.equal(res.body.transcription.RecognitionStatus, "Success");
  });

  test("POST /api/speech-to-text returns 400, not 500, when the file is missing", async () => {
    // This path previously referenced an undefined `sttLogger` and threw.
    const res = await invoke(speechRoutes, "post", "/speech-to-text", { body: {} });
    assert.equal(res.statusCode, 400);
  });

  test("POST /api/text-to-speech no longer requires a caller-supplied apiKey", async () => {
    const res = await invoke(speechRoutes, "post", "/text-to-speech", {
      body: { preset: "en-US-AriaNeural", text: "hello" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "audio/wav");
    // Give the piped stream a tick to flush, then check the audio arrived.
    await new Promise((r) => setImmediate(r));
    assert.equal(res.piped().toString(), "FAKEAUDIOBYTES");
  });

  test("POST /api/text-to-speech still 400s without a preset", async () => {
    const res = await invoke(speechRoutes, "post", "/text-to-speech", {
      body: { text: "hello" },
    });
    assert.equal(res.statusCode, 400);
  });

  test("GET /api/health reports the voice instance", async () => {
    const res = await invoke(speechRoutes, "get", "/health", { body: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.voiceInstance.region, "eastus2");
    assert.equal(res.body.status, "healthy");
  });
});
