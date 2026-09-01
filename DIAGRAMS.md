# System Architecture Diagram

## Request/Response Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│                                                                   │
│  POST /api/llm-query                                            │
│  {                                                              │
│    "question": "...",                                           │
│    "streaming": true/false,                                     │
│    "overrideConfig": {"sessionId": "..."}                       │
│  }                                                              │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  REQUEST LOGGER        │
                    │  (Middleware)          │
                    │  - Log request         │
                    │  - Track timing        │
                    │  - Mask sensitive data │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  SPEECH ROUTES         │
                    │  (Router)              │
                    │                        │
                    │  POST /api/llm-query   │
                    └────────────┬───────────┘
                                 │
                                 ▼
        ┌────────────────────────────────────────────┐
        │     LLM CONTROLLER                         │
        │  (Business Logic & Orchestration)          │
        │                                            │
        │  ┌──────────────────────────────────────┐ │
        │  │ 1. Create LLMRequest object          │ │
        │  │ 2. Validate request                  │ │
        │  │ 3. Create LLMResponse object         │ │
        │  │ 4. Check streaming flag              │ │
        │  └──────────────────┬───────────────────┘ │
        │                     │                      │
        │  ┌──────────────────┴───────────────────┐  │
        │  │                                      │  │
        │  ▼                                      ▼  │
        │┌─────────────────────┐    ┌──────────────┐│
        ││  STREAMING PATH     │    │NON-STREAMING ││
        ││                     │    │PATH          ││
        ││ • Set SSE headers   │    │              ││
        ││ • Send "start"      │    │ • Call with  ││
        ││ • Query with        │    │   stream:    ││
        ││   stream: true      │    │   false      ││
        ││ • Parse chunks      │    │ • Extract    ││
        ││ • Send "token"      │    │   content    ││
        ││ • Send "metadata"   │    │ • Return     ││
        ││ • Send "end"        │    │   JSON       ││
        ││                     │    │              ││
        └│─────────┬───────────┘    └──────┬───────┘│
        └────────────┼───────────────────────┼───────┘
                     │                       │
                     ▼                       ▼
        ┌────────────────────────────────────────────┐
        │     LLM GATEWAY SERVICE                    │
        │  (External API Integration)                │
        │                                            │
        │  ┌──────────────────────────────────────┐ │
        │  │ 1. Get Azure OAuth token             │ │
        │  │ 2. Build headers and payload         │ │
        │  │ 3. POST to LLM Gateway API           │ │
        │  │    - Pass stream: true/false         │ │
        │  │    - Include model, temperature, etc │ │
        │  │ 4. Return response/stream object     │ │
        │  └──────────────────────────────────────┘ │
        └────────────┬───────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────────────┐
        │  EXTERNAL: LLM GATEWAY API                 │
        │  (https://gateway-intranet.apim-dev...)   │
        │                                            │
        │  Azure OpenAI Endpoint                     │
        │  Model: gpt-4o                             │
        └────────────┬───────────────────────────────┘
                     │
                     ├─ Streaming: SSE chunks         
                     │  data: {"choices":[{"delta":{...}}]}
                     │
                     └─ Non-Streaming: Complete JSON
                        {"choices":[{"message":{...}}]}
                     │
                     ▼
        ┌────────────────────────────────────────────┐
        │     LLM CONTROLLER (parse)                 │
        │                                            │
        │  STREAMING:                                │
        │  • Parse "data: {...}" lines               │
        │  • Extract choices[0].delta.content        │
        │  • Format as SSE event                     │
        │  • Send to response                        │
        │                                            │
        │  NON-STREAMING:                            │
        │  • Extract choices[0].message.content      │
        │  • Wrap in JSON response                   │
        │  • Add metadata                            │
        └────────────┬───────────────────────────────┘
                     │
                     ▼
                    ┌────────────────────┐
                    │  ERROR HANDLER     │
                    │  (Middleware)      │
                    │                    │
                    │  Catches any errors│
                    │  Formats response  │
                    │  Logs error        │
                    └────────────┬───────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  RESPONSE TO CLIENT    │
                    │                        │
                    │  STREAMING:            │
                    │  text/event-stream     │
                    │  data: {...}\n\n       │
                    │  data: {...}\n\n       │
                    │                        │
                    │  NON-STREAMING:        │
                    │  application/json      │
                    │  {...}                 │
                    └────────────────────────┘
```

## Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SERVER.JS                                  │
│                    (Application Entry Point)                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Middleware Stack                                              │ │
│  │  1. express.json()     - Parse JSON bodies                   │ │
│  │  2. express.static()   - Serve static files                  │ │
│  │  3. requestLogger      - Log all requests          ┐         │ │
│  │  4. Error Handler      - Catch all errors         │ NEW     │ │
│  │                                                   └─────────┘ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Routes                                                        │ │
│  │  GET  /                      → public/index.html             │ │
│  │  GET  /health                → Health status                 │ │
│  │  POST /api/text-to-speech    → azureTTSService              │ │
│  │  POST /api/speech-to-text    → azureSTTService              │ │
│  │  POST /api/llm-query         → llmController      ┐         │ │
│  │                                                   │ UPDATED │ │
│  │                                                   └─────────┘ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
         │                         │                      │
         ▼                         ▼                      ▼
   ┌──────────────┐      ┌──────────────────┐    ┌──────────────────┐
   │  SERVICES    │      │  CONTROLLERS     │    │  MODELS          │
   │              │      │                  │    │                  │
   │ • azureAuth  │      │ • llmController  │    │ • LLMRequest  ┐  │
   │ • azureSTT   │      │   - queryLLM()   │    │   - validate  │ N│
   │ • azureTTS   │      │   - streaming    │    │   - serialize │ E│
   │ • llmGateway │      │   - non-streaming│    │               │ W│
   │   - getToken │      │                  │    │ • LLMResponse │  │
   │   - queryLLM │      │                  │    │   - metadata  │  │
   │              │      │                  │    │   - SSE fmt   └  │
   └──────────────┘      └──────────────────┘    └──────────────────┘
         │                         │                      │
         └──────────────┬──────────┴──────────────────────┘
                        │
                        ▼
   ┌──────────────────────────────────┐
   │  UTILITIES                       │
   │                                  │
   │  ┌────────────────────────────┐  │
   │  │ logger.js                  │  │
   │  │ - error()                  │  │
   │  │ - warn()                   │  │
   │  │ - info()                   │  │
   │  │ - success()                │  │
   │  │ - debug()                  │  │
   │  │ - stream()                 │  │
   │  │ - api()                    │  │
   │  └────────────────────────────┘  │
   │                                  │
   │  ┌────────────────────────────┐  │
   │  │ validators.js              │  │
   │  │ - validateLLMRequest()     │  │
   │  │ - validateTTSRequest()     │  │
   │  └────────────────────────────┘  │
   └──────────────────────────────────┘
```

## Data Model Relationships

```
┌─────────────────────────┐
│    LLMRequest           │
├─────────────────────────┤
│ - question: string      │
│ - streaming: boolean    │
│ - sessionId: string     │
│ - timestamp: ISO string │
│ - model: string         │
│ - temperature: number   │
│ - maxTokens: number     │
├─────────────────────────┤
│ Methods:                │
│ - isValid()             │
│ - toJSON()              │
│ - generateSessionId()   │
└────────────┬────────────┘
             │ 1..1
             │
             │ Used by
             │
             ▼
┌─────────────────────────────────┐
│    LLMController                │
├─────────────────────────────────┤
│ - queryLLM()                    │
│ - handleStreamingResponse()     │
│ - handleNonStreamingResponse()  │
├─────────────────────────────────┤
│ Uses:                           │
│ - LLMRequest (input)            │
│ - LLMResponse (output)          │
│ - llmGateway (API calls)        │
└────────────┬────────────────────┘
             │ 1..many
             │ Creates
             │
             ▼
┌──────────────────────────────────┐
│    LLMResponse                   │
├──────────────────────────────────┤
│ - chatId: string                 │
│ - chatMessageId: string          │
│ - question: string               │
│ - sessionId: string              │
│ - response: string               │
│ - streaming: boolean             │
│ - model: string                  │
│ - timestamp: ISO string          │
│ - usage: {tokens}                │
│ - error: string | null           │
├──────────────────────────────────┤
│ Methods:                         │
│ - addUsage()                     │
│ - addError()                     │
│ - toJSON()                       │
│ - toSSE()                        │
└──────────────────────────────────┘
```

## SSE Event Flow (Streaming Response)

```
Client                          Server
  │                               │
  ├──── POST /api/llm-query ────→ │
  │ {question:"...",             │
  │  streaming: true}            │
  │                               │
  │                           ┌───┴────────┐
  │                           │ Process    │
  │                           │ Request    │
  │                           └───┬────────┘
  │                               │
  │ ← Set-up SSE Connection ──────┤
  │ Content-Type: text/event-stream│
  │                               │
  │ ← Send "start" event ────────│
  │ data: {"event":"start"...}\n\n│
  │                               │
  │                           ┌───┴──────────────┐
  │                           │ Query LLM API    │
  │                           │ Wait for tokens  │
  │                           └───┬──────────────┘
  │                               │
  │ ← Send "token" event ────────│
  │ data: {"event":"token"...}\n\n │ (Token 1)
  │                               │
  │ ← Send "token" event ────────│
  │ data: {"event":"token"...}\n\n │ (Token 2)
  │                               │
  │ ← Send "token" event ────────│
  │ data: {"event":"token"...}\n\n │ (Token 3)
  │                               │
  │ ← ... more tokens ──────────│
  │                               │
  │                           ┌───┴──────────────┐
  │                           │ Stream Complete  │
  │                           └───┬──────────────┘
  │                               │
  │ ← Send "metadata" event ──────│
  │ data: {"event":"metadata"...}\n\n
  │ {chatId, chatMessageId, ...}  │
  │                               │
  │ ← Send "end" event ──────────│
  │ data: {"event":"end"...}\n\n  │
  │                               │
  │ ← Close Connection ──────────│
  │ (200 OK)                      │
  │                               │

Time: ~100-2000ms depending on response length
```

## Non-Streaming Response Flow

```
Client                          Server
  │                               │
  ├──── POST /api/llm-query ────→ │
  │ {question:"...",             │
  │  streaming: false}           │
  │                               │
  │                           ┌───┴────────┐
  │                           │ Process    │
  │                           │ Request    │
  │                           └───┬────────┘
  │                               │
  │                           ┌───┴──────────────┐
  │                           │ Query LLM API    │
  │                           │ Wait for result  │
  │                           └───┬──────────────┘
  │                               │
  │ ← JSON Response ──────────────│
  │ {                             │
  │   "chatId": "...",            │
  │   "chatMessageId": "...",     │
  │   "question": "...",          │
  │   "sessionId": "...",         │
  │   "response": "...",          │
  │   "metadata": {               │
  │     "model": "gpt-4o",        │
  │     "timestamp": "...",       │
  │     "streaming": false,       │
  │     "usage": {...}            │
  │   }                           │
  │ }                             │
  │                               │
  │ ← Close Connection ──────────│
  │ (200 OK)                      │
  │                               │

Time: ~1000-5000ms for full response
```

## Error Handling Flow

```
Any Component
    │
    ├─ Exception Thrown
    │
    ▼
┌──────────────────────────────┐
│  Error Handler Middleware    │
├──────────────────────────────┤
│ 1. Catch error               │
│ 2. Log with details          │
│ 3. Determine HTTP status     │
│ 4. Format response           │
│ 5. Send to client            │
└──────────────────────────────┘
    │
    ▼
┌──────────────────────────────┐
│  Error Response              │
│  {                           │
│    "error": "message",       │
│    "code": "ERROR_CODE",     │
│    "timestamp": "...",       │
│    "stack": "..." (dev only) │
│  }                           │
│  HTTP Status Code            │
└──────────────────────────────┘
    │
    ▼
Client receives
error response
```
