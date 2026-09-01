# Project Structure Documentation

## Architecture Overview

This project follows a clean MVC (Model-View-Controller) architecture without WebSockets, using HTTP streaming with Server-Sent Events (SSE) for real-time responses.

```
app/
├── controllers/        # Request handlers and business logic
│   └── llmController.js
├── middleware/         # Express middleware
│   ├── errorHandler.js
│   └── requestLogger.js
├── models/             # Data models and schemas
│   ├── LLMRequest.js
│   └── LLMResponse.js
├── routes/             # API route definitions
│   └── speechRoutes.js
├── services/           # External service integrations
│   ├── azureAuthService.js
│   ├── azureSTTService.js
│   ├── azureTTSService.js
│   └── llmGateway.js
├── utils/              # Utility functions
│   ├── logger.js
│   └── validators.js
├── config/             # Configuration management
│   └── config.js
├── public/             # Static files
├── server.js           # Application entry point
└── package.json        # Dependencies
```

## Key Components

### Controllers (`controllers/`)
- **llmController.js**: Orchestrates LLM query requests
  - `queryLLM()`: Main entry point for LLM queries
  - `handleStreamingResponse()`: Manages SSE streaming responses
  - `handleNonStreamingResponse()`: Handles JSON responses

### Models (`models/`)
- **LLMRequest.js**: Validates and structures incoming requests
  - Session management
  - Request validation
  - Auto-generated session IDs

- **LLMResponse.js**: Formats and structures responses
  - SSE event formatting
  - Metadata management
  - Response serialization

### Services (`services/`)
- **llmGateway.js**: LLM API communication
  - Azure OAuth token acquisition
  - Model querying with streaming support
  - Error handling and logging

- **azureAuthService.js**: Azure authentication
- **azureSTTService.js**: Speech-to-Text
- **azureTTSService.js**: Text-to-Speech

### Middleware (`middleware/`)
- **requestLogger.js**: HTTP request/response logging with timing
- **errorHandler.js**: Centralized error handling

### Utilities (`utils/`)
- **logger.js**: Structured logging with emoji indicators
- **validators.js**: Request validation helpers

## API Endpoints

### POST /api/llm-query

#### Request Format
```json
{
  "question": "Your question here",
  "streaming": true,
  "overrideConfig": {
    "sessionId": "custom-session-id"
  }
}
```

#### Streaming Response (SSE)
```
data: {"event":"start","data":""}
data: {"event":"token","data":"I'm"}
data: {"event":"token","data":" going"}
data: {"event":"metadata","data":{"chatId":"...","question":"..."}}
data: {"event":"end","data":"[DONE]"}
```

#### Non-Streaming Response (JSON)
```json
{
  "chatId": "chat-123",
  "chatMessageId": "msg-456",
  "question": "Your question",
  "sessionId": "session-789",
  "response": "Full response text",
  "metadata": {
    "model": "gpt-4o",
    "timestamp": "2025-11-28T...",
    "streaming": false,
    "usage": {
      "prompt_tokens": 10,
      "completion_tokens": 20,
      "total_tokens": 30
    }
  }
}
```

## Request Flow

```
HTTP Request
    ↓
requestLogger (middleware)
    ↓
speechRoutes (/api/llm-query)
    ↓
llmController.queryLLM()
    ↓
[Streaming Path]          [Non-Streaming Path]
    ↓                           ↓
handleStreamingResponse()  handleNonStreamingResponse()
    ↓                           ↓
llmGateway.queryLLM()      llmGateway.queryLLM()
(stream: true)            (stream: false)
    ↓                           ↓
Parse SSE chunks         Parse JSON response
    ↓                           ↓
Send SSE events          Return JSON
    ↓
errorHandler (middleware)
```

## Configuration

Environment variables in `.env`:
```
LLM_CLIENT_ID=...
LLM_CLIENT_SECRET=...
LLM_TENANT_ID=...
LLM_GATEWAY_KEY=...
LLM_GATEWAY_BASE_URL=...
LLM_MODEL=gpt-4o
```

## Error Handling

All errors are centralized through `errorHandler` middleware:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2025-11-28T..."
}
```

## Logging

All components use emoji-based logging:
- ✅ Success
- ❌ Error
- ⚠️ Warning
- ℹ️ Info
- 🐛 Debug
- 🔄 Streaming
- 🌐 API calls

## Data Flow for Streaming

1. Client sends request with `streaming: true`
2. Controller creates LLMRequest and validates
3. Controller calls llmGateway with `stream: true`
4. llmGateway sends request with `stream: true` to LLM API
5. API returns chunked response (Server-Sent Events format)
6. Controller parses SSE chunks:
   ```
   data: {"choices":[{"delta":{"content":"token"}}]}
   ```
7. Controller extracts `choices[0].delta.content`
8. Controller sends SSE events to client with proper formatting:
   ```
   data: {"event":"token","data":"token"}\n\n
   ```
9. Client receives streamed tokens in real-time

## Non-Streaming Flow

1. Client sends request with `streaming: false`
2. Controller creates LLMRequest and validates
3. Controller calls llmGateway with `stream: false`
4. llmGateway sends request with `stream: false` to LLM API
5. API returns complete response as JSON
6. Controller extracts `choices[0].message.content`
7. Controller returns complete JSON response with metadata

## Testing Streaming

```bash
curl -N -H "Content-Type: application/json" \
  -d '{"question":"Tell me about Eli Lilly","streaming":true}' \
  http://localhost:3000/api/llm-query
```

## Testing Non-Streaming

```bash
curl -H "Content-Type: application/json" \
  -d '{"question":"Tell me about Eli Lilly","streaming":false}' \
  http://localhost:3000/api/llm-query
```
