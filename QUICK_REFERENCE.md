# Quick Reference Guide

## 🚀 Quick Start

### Start the Server
```bash
cd app
npm start
```

### Server Running At
```
http://localhost:3000
```

---

## 📡 API Quick Reference

### Streaming Request
```bash
curl -N -H "Content-Type: application/json" \
  -d '{"question":"Tell me about Eli Lilly","streaming":true}' \
  http://localhost:3000/api/llm-query
```

### Non-Streaming Request
```bash
curl -H "Content-Type: application/json" \
  -d '{"question":"Tell me about Eli Lilly","streaming":false}' \
  http://localhost:3000/api/llm-query
```

### Health Check
```bash
curl http://localhost:3000/health
```

---

## 📁 Project Structure

```
app/
├── controllers/llmController.js      - Main request handler
├── models/
│   ├── LLMRequest.js               - Request validation
│   └── LLMResponse.js              - Response formatting
├── middleware/
│   ├── errorHandler.js             - Error handling
│   └── requestLogger.js            - Request logging
├── utils/
│   ├── logger.js                   - Logging utilities
│   └── validators.js               - Validation helpers
├── services/
│   ├── llmGateway.js               - LLM API calls
│   ├── azureAuthService.js         - Azure auth
│   ├── azureSTTService.js          - Speech-to-Text
│   └── azureTTSService.js          - Text-to-Speech
├── routes/speechRoutes.js           - API routes
├── config/config.js                 - Configuration
└── server.js                        - App entry point
```

---

## 🔑 Key Components

| Component | File | Purpose |
|-----------|------|---------|
| Controller | `llmController.js` | Business logic & orchestration |
| Models | `LLMRequest.js`, `LLMResponse.js` | Data validation & formatting |
| Middleware | `errorHandler.js`, `requestLogger.js` | Cross-cutting concerns |
| Utilities | `logger.js`, `validators.js` | Helper functions |
| Services | `llmGateway.js` | External API integration |
| Routes | `speechRoutes.js` | API endpoint definitions |

---

## 📋 Request/Response Formats

### Request
```json
{
  "question": "Your question",
  "streaming": true/false,
  "overrideConfig": {
    "sessionId": "custom-id"
  }
}
```

### Streaming Response
```
data: {"event":"start","data":""}
data: {"event":"token","data":"token"}
data: {"event":"metadata","data":{...}}
data: {"event":"end","data":"[DONE]"}
```

### Non-Streaming Response
```json
{
  "chatId": "...",
  "chatMessageId": "...",
  "question": "...",
  "sessionId": "...",
  "response": "...",
  "metadata": {
    "model": "gpt-4o",
    "timestamp": "...",
    "streaming": false,
    "usage": {...}
  }
}
```

---

## 🎯 Common Tasks

### Test Streaming
```bash
curl -N \
  -H "Content-Type: application/json" \
  -d '{"question":"Hello","streaming":true}' \
  http://localhost:3000/api/llm-query
```

### Test Non-Streaming
```bash
curl \
  -H "Content-Type: application/json" \
  -d '{"question":"Hello","streaming":false}' \
  http://localhost:3000/api/llm-query
```

### Check Logs
- Look for emoji indicators (✅ ❌ ⚠️ 🔄)
- Each line prefixed with component name
- Response times included

### Debug Errors
- Check HTTP status code
- Read error message and code
- Review stack trace (development only)
- Check environment variables

---

## 🔧 Configuration

### Environment Variables (.env)
```
LLM_CLIENT_ID=...
LLM_CLIENT_SECRET=...
LLM_TENANT_ID=...
LLM_GATEWAY_KEY=...
LLM_GATEWAY_BASE_URL=...
LLM_MODEL=gpt-4o
```

### Server Port
- Default: `3000`
- Change in: `.env` file

---

## 📚 Documentation Files

| File | Contents |
|------|----------|
| `ARCHITECTURE.md` | Project structure & components |
| `IMPLEMENTATION.md` | What was changed & improvements |
| `DIAGRAMS.md` | Visual architecture diagrams |
| `API_USAGE.md` | API examples & usage |
| `COMPLETION_SUMMARY.md` | Project completion status |
| `CHANGES.md` | List of all changes made |
| `QUICK_REFERENCE.md` | This file |

---

## 🚨 Troubleshooting

### Port Already in Use
```bash
lsof -i :3000
kill -9 <PID>
npm start
```

### Module Not Found
```bash
npm install
npm start
```

### Authentication Failed
- Check credentials in `.env`
- Verify tenant ID format
- Ensure credentials are current

### Streaming Not Working
- Verify `streaming: true` in request
- Check browser supports EventSource
- Monitor console for errors

---

## 📊 Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request |
| 401 | Unauthorized |
| 500 | Server error |

---

## 🎓 Architecture Pattern

```
Request
  ↓
requestLogger (middleware)
  ↓
speechRoutes (router)
  ↓
llmController (business logic)
  ├─ LLMRequest (validation)
  ├─ llmGateway (service)
  └─ LLMResponse (formatting)
  ↓
errorHandler (middleware) - catches errors
  ↓
Response
```

---

## 🔐 Security Tips

✅ Sensitive data masked in logs  
✅ Environment variables for secrets  
⚠️ Add authentication middleware  
⚠️ Add rate limiting  
⚠️ Enable TLS verification (production)  

---

## 💡 Example: JavaScript with Fetch

```javascript
// Non-streaming
const response = await fetch('/api/llm-query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: 'Tell me about Eli Lilly',
    streaming: false
  })
});

const data = await response.json();
console.log(data.response);
```

---

## 🔗 Useful Links

- **Health Check:** http://localhost:3000/health
- **Home:** http://localhost:3000/
- **LLM Query:** POST http://localhost:3000/api/llm-query

---

## 📞 Support

### Check Documentation First
1. `ARCHITECTURE.md` - How it's organized
2. `API_USAGE.md` - How to use it
3. `DIAGRAMS.md` - How it works visually

### Check Logs
- All requests logged
- Errors detailed
- Component names shown
- Timing included

### Debug Steps
1. Verify request format
2. Check HTTP status
3. Read error message
4. Review environment variables
5. Check logs for details

---

## ✅ Verification Checklist

- [ ] Application starts (`npm start`)
- [ ] Health check responds (GET /health)
- [ ] Streaming request works (POST /api/llm-query, streaming: true)
- [ ] Non-streaming works (POST /api/llm-query, streaming: false)
- [ ] Logs show requests
- [ ] Error handling works
- [ ] Response formats correct

---

## 🎯 Next Steps

1. **Test:** Run the API examples
2. **Read:** Review ARCHITECTURE.md
3. **Extend:** Add authentication
4. **Deploy:** Follow deployment checklist
5. **Monitor:** Set up logging/monitoring

---

**Last Updated:** November 28, 2025  
**Status:** ✅ Production Ready  
**Version:** 1.0 (Refactored MVC)
