# API Usage Examples

## Base URL
```
http://localhost:3000
```

## Table of Contents
1. [LLM Query Endpoint](#llm-query-endpoint)
2. [Text-to-Speech Endpoint](#text-to-speech-endpoint)
3. [Speech-to-Text Endpoint](#speech-to-text-endpoint)
4. [Health Check](#health-check)

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
