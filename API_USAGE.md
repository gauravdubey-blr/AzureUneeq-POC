# API Usage Examples

## Base URL
```
http://localhost:3000
```

## Table of Contents
1. [REST Voice API](#rest-voice-api)  ← new
2. [LLM Query Endpoint](#llm-query-endpoint)
3. [Text-to-Speech Endpoint](#text-to-speech-endpoint) (legacy)
4. [Speech-to-Text Endpoint](#speech-to-text-endpoint) (legacy)
5. [Health Check](#health-check)

---

## REST Voice API

Voice input and voice output now resolve through a single voice instance
(`config/voiceInstance.js`) instead of endpoints hard-coded in the STT/TTS
services. Repointing the app at a new Azure resource is a config change.

| Route | In | Out |
|-------|----|-----|
| `POST /api/voice/transcribe` | `multipart/form-data`: `audio` file, optional `language` | `{ text, confidence, durationMs, language }` |
| `POST /api/voice/speak` | JSON `{ text, voice?, format?, rate?, pitch?, style?, ssml?, encoding? }` | audio bytes, or JSON with base64 when `encoding: "base64"` |
| `POST /api/voice/converse` | `multipart/form-data`: `audio`, optional `language`/`voice`/`format`/`speak`/`model` | `{ transcript, reply, audio (base64) }` |
| `GET /api/voice/config` | — | resolved instance + route list (no secrets) |

`format` is one of `pcm16` (default), `pcm24`, `wav`, `mp3`, `mp3hq`, `raw24`.
`pcm16` is the format the legacy `/api/text-to-speech` route always returned, so
existing clients get byte-identical audio.

### Voice input

```bash
curl -F audio=@turn.wav -F language=en-US \
     http://localhost:3000/api/voice/transcribe
```

```json
{
  "success": true,
  "text": "What is the starting dose of Mounjaro?",
  "confidence": 0.93,
  "durationMs": 2100,
  "language": "en-US"
}
```

### Voice output

```bash
curl -H 'Content-Type: application/json' \
     -d '{"text":"The starting dose is 2.5 mg once weekly.","format":"mp3"}' \
     http://localhost:3000/api/voice/speak --output reply.mp3
```

Add `"encoding":"base64"` to get JSON instead of raw bytes — usually what a
browser feeding an `AudioContext` wants.

### One full turn

```bash
curl -F audio=@question.wav -F model=cortex \
     http://localhost:3000/api/voice/converse
```

Chains transcribe → model → synthesize. `model=cortex` (default) routes through
`cortexService` with the Mounjaro system prompt; `model=llm` uses the LLM
Gateway. Send `speak=false` to get text only. If synthesis fails, the turn still
returns the model reply with a `synthesisError` field rather than failing.

### Error mapping

| Status | Meaning |
|--------|---------|
| `400` | Bad request body, bad audio, or unsupported format/encoding |
| `413` | Audio over `VOICE_MAX_AUDIO_BYTES`, or text over `VOICE_MAX_TTS_CHARS` |
| `415` | Audio content type not in the allowlist |
| `429` | Passed through from Azure so callers can back off |
| `503` | Voice instance not configured |
| `502` | Upstream failure. An Azure `401`/`403` is reported as `502` on purpose — a bad server-side key is not the caller's authorization problem |

Upstream error bodies are logged server-side but never returned to the caller.

### Tests

```bash
npm test        # node --test "test/*.test.js" — 67 checks
```

Azure is never contacted: the services expose an injectable `httpClient` and the
route handlers are driven with fake req/res. No new dependencies — Node's
built-in test runner only.

---

## LLM Query Endpoint

### POST `/api/llm-query`

Supports both streaming and non-streaming responses for LLM queries.

### Streaming Request (Real-time Token Streaming)

**Request:**
```bash
curl -N \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Tell me about Eli Lilly and their mission",
    "streaming": true
  }' \
  http://localhost:3000/api/llm-query
```

**Response (Server-Sent Events):**
```
data: {"event":"start","data":""}

data: {"event":"token","data":"Eli"}
data: {"event":"token","data":" Lilly"}
data: {"event":"token","data":" is"}
data: {"event":"token","data":" a"}
data: {"event":"token","data":" global"}
data: {"event":"token","data":" pharmaceutical"}
data: {"event":"token","data":" company..."}

data: {"event":"metadata","data":{"chatId":"chat-1234567890-abc123","chatMessageId":"1234567890","question":"Tell me about Eli Lilly...","sessionId":"session-1234567890-abc123","tokenCount":45,"model":"gpt-4o","timestamp":"2025-11-28T12:00:00.000Z"}}

data: {"event":"end","data":"[DONE]"}
```

### Streaming with Custom Session ID

**Request:**
```bash
curl -N \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the main research areas at Eli Lilly?",
    "streaming": true,
    "overrideConfig": {
      "sessionId": "user-123-session-456"
    }
  }' \
  http://localhost:3000/api/llm-query
```

**Response:** Same format as above, with custom sessionId in metadata

### Non-Streaming Request (Full Response)

**Request:**
```bash
curl -H "Content-Type: application/json" \
  -d '{
    "question": "What is Eli Lilly known for?",
    "streaming": false
  }' \
  http://localhost:3000/api/llm-query
```

**Response (JSON):**
```json
{
  "chatId": "chat-1234567890-xyz789",
  "chatMessageId": "1234567890",
  "question": "What is Eli Lilly known for?",
  "sessionId": "session-1234567890-abc123",
  "response": "Eli Lilly is a global pharmaceutical company known for developing innovative medicines in areas such as oncology, immunology, neuroscience, and endocrinology. The company has a strong commitment to research and development, focusing on addressing serious health conditions. They are also known for their commitment to access and affordability of medicines globally.",
  "metadata": {
    "model": "gpt-4o",
    "timestamp": "2025-11-28T12:00:00.000Z",
    "streaming": false,
    "usage": {
      "prompt_tokens": 8,
      "completion_tokens": 87,
      "total_tokens": 95
    }
  }
}
```

### Non-Streaming with Different Model Parameters

**Request:**
```bash
curl -H "Content-Type: application/json" \
  -d '{
    "question": "Summarize Eli Lilly'\''s pipeline in one sentence",
    "streaming": false,
    "model": "gpt-4o",
    "temperature": 0.3,
    "maxTokens": 100
  }' \
  http://localhost:3000/api/llm-query
```

### Error Response - Missing Question

**Request:**
```bash
curl -H "Content-Type: application/json" \
  -d '{"streaming": true}' \
  http://localhost:3000/api/llm-query
```

**Response (HTTP 400):**
```json
{
  "error": "Invalid Request",
  "message": "Please provide a question in the request body",
  "code": "INVALID_REQUEST"
}
```

### Error Response - Server Error

**Response (HTTP 500):**
```json
{
  "error": "LLM Query Failed",
  "message": "Token request failed: unauthorized_client",
  "code": "LLM_QUERY_FAILED"
}
```

---

## Text-to-Speech Endpoint

> **Legacy.** Still supported and now backed by the same service as
> `/api/voice/speak`. Two behaviour changes:
> - `apiKey` in the payload is **accepted but ignored**. Credentials come from
>   the server's voice instance. Previously this field was *required* but never
>   actually used for the outbound call, and the whole request body — including
>   the key — was logged to stdout. Both issues are fixed.
> - `Content-Type` now reflects the real audio format instead of always claiming
>   `application/octet-stream`. Add an optional `format` field to choose one.
>
> Prefer `/api/voice/speak` for new work.

### POST `/api/text-to-speech`

Converts text to speech audio.

**Request:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Welcome to Eli Lilly",
    "preset": "en-US-AriaNeural",
    "apiKey": "YOUR_AZURE_API_KEY"
  }' \
  -o output.wav \
  http://localhost:3000/api/text-to-speech
```

**Response:**
- Audio file in WAV format
- HTTP 200 OK

---

## Speech-to-Text Endpoint

> **Legacy.** Still supported and now backed by the same service as
> `/api/voice/transcribe`. The response gains normalized `text`, `confidence`,
> `durationMs` and `language` fields; the original `transcription` field still
> carries Azure's raw detailed payload, so existing callers keep working.
> A missing-file request now correctly returns `400` (it previously hit an
> undefined logger and threw a `500`).
>
> Prefer `/api/voice/transcribe` for new work.

### POST `/api/speech-to-text`

Converts speech audio to text.

**Request (multipart form-data):**
```bash
curl -X POST \
  -F "audio=@audio.wav" \
  -F "apiKey=YOUR_AZURE_API_KEY" \
  http://localhost:3000/api/speech-to-text
```

**Response:**
```json
{
  "recognizedText": "Welcome to Eli Lilly",
  "confidence": 0.95,
  "duration": 2.5
}
```

---

## Health Check

### GET `/api/health`

**Request:**
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-11-28T12:00:00.000Z",
  "modules": {
    "config": "loaded",
    "auth": "initialized",
    "tts": "available"
  }
}
```

---

## JavaScript/Fetch Examples

### Streaming with JavaScript EventSource

```javascript
// Listen to streaming response
const eventSource = new EventSource('/api/llm-query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    question: 'Tell me about Eli Lilly',
    streaming: true
  })
});

let fullResponse = '';

eventSource.addEventListener('start', (event) => {
  console.log('Streaming started');
});

eventSource.addEventListener('token', (event) => {
  const data = JSON.parse(event.data);
  const token = data.data;
  fullResponse += token;
  console.log('Token:', token);
  // Update UI with token in real-time
  document.getElementById('response').textContent = fullResponse;
});

eventSource.addEventListener('metadata', (event) => {
  const metadata = JSON.parse(event.data).data;
  console.log('Metadata:', metadata);
});

eventSource.addEventListener('end', (event) => {
  console.log('Streaming complete');
  eventSource.close();
});

eventSource.addEventListener('error', (event) => {
  console.error('Streaming error:', event);
  eventSource.close();
});
```

### Non-Streaming with Fetch

```javascript
async function queryLLM() {
  const response = await fetch('/api/llm-query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      question: 'Tell me about Eli Lilly',
      streaming: false
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Error:', error);
    return;
  }

  const data = await response.json();
  console.log('Response:', data.response);
  console.log('Metadata:', data.metadata);
  
  // Update UI
  document.getElementById('response').textContent = data.response;
}

queryLLM();
```

### React Component Example (Streaming)

```javascript
import React, { useState } from 'react';

function LLMStreamingComponent() {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState(null);

  const handleStream = async () => {
    if (!question) return;
    
    setLoading(true);
    setResponse('');
    
    try {
      const eventSource = new EventSource('/api/llm-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
          streaming: true
        })
      });

      eventSource.addEventListener('token', (event) => {
        const token = JSON.parse(event.data).data;
        setResponse(prev => prev + token);
      });

      eventSource.addEventListener('metadata', (event) => {
        const meta = JSON.parse(event.data).data;
        setMetadata(meta);
      });

      eventSource.addEventListener('end', () => {
        eventSource.close();
        setLoading(false);
      });

      eventSource.addEventListener('error', () => {
        eventSource.close();
        setLoading(false);
      });
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask a question..."
        disabled={loading}
      />
      <button onClick={handleStream} disabled={loading}>
        {loading ? 'Streaming...' : 'Ask'}
      </button>
      <div>{response}</div>
      {metadata && <div>Tokens: {metadata.tokenCount}</div>}
    </div>
  );
}

export default LLMStreamingComponent;
```

---

## Testing with Insomnia/Postman

### Streaming Request

1. **Method:** POST
2. **URL:** `http://localhost:3000/api/llm-query`
3. **Headers:** `Content-Type: application/json`
4. **Body (JSON):**
```json
{
  "question": "Tell me about Eli Lilly",
  "streaming": true,
  "overrideConfig": {
    "sessionId": "test-session-123"
  }
}
```
5. **Response Type:** Select "Stream" in Insomnia or watch streaming response in Postman

### Non-Streaming Request

1. **Method:** POST
2. **URL:** `http://localhost:3000/api/llm-query`
3. **Headers:** `Content-Type: application/json`
4. **Body (JSON):**
```json
{
  "question": "Tell me about Eli Lilly",
  "streaming": false
}
```
5. **Response Type:** JSON

---

## Response Status Codes

| Status Code | Meaning | Example |
|---|---|---|
| 200 | Request successful | Streaming or JSON response returned |
| 400 | Bad request | Missing required field (question) |
| 401 | Unauthorized | Invalid credentials |
| 500 | Server error | Token request failed, LLM API error |

---

## Performance Notes

### Streaming
- **Latency to first token:** 500-1000ms
- **Token generation time:** ~100ms per token
- **Total time for 100 tokens:** 10-15 seconds
- **Benefit:** User sees response in real-time

### Non-Streaming
- **Total response time:** 1000-5000ms
- **Depends on:** Question length, model complexity, server load
- **Benefit:** Simpler integration, complete response guaranteed

---

## Rate Limiting (Future)

Currently no rate limiting. Recommendations:
- Implement per-IP rate limiting
- Implement per-session rate limiting
- Add token bucket algorithm
- Cache frequent queries

---

## Error Handling Best Practices

1. **Check HTTP status code first**
2. **Parse error response for message and code**
3. **Log errors with timestamp and request ID**
4. **Implement retry logic for 5xx errors**
5. **Show user-friendly error messages**

Example:
```javascript
const response = await fetch('/api/llm-query', {...});

if (!response.ok) {
  const error = await response.json();
  
  switch (error.code) {
    case 'INVALID_REQUEST':
      // Show validation error to user
      break;
    case 'LLM_QUERY_FAILED':
      // Retry or show API error
      break;
    default:
      // Generic error handling
  }
}
```

---

## Next Steps

1. Implement authentication (JWT tokens)
2. Add rate limiting middleware
3. Implement caching for common queries
4. Add request/response logging to database
5. Create WebUI dashboard for testing
6. Implement chat history storage
