# Simple Express.js Application

A basic Node.js application using Express.js with simple routes and an HTML interface.

## Features

- Express.js server with multiple routes
- Static file serving
- Simple HTML interface with interactive buttons
- JSON and text API endpoints
- Health check endpoint

## API Endpoints

- `GET /` - Serves the main HTML page
- `GET /api/hello` - Returns a JSON response with a hello message
- `GET /api/text` - Returns a plain text response
- `GET /health` - Health check endpoint

## Getting Started

### Prerequisites

- Node.js (version 12 or higher)
- npm

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. Start the server:

   ```bash
   npm start
   ```

2. For development with auto-reload:

   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:3000`

The server will start on port 3000 by default, or you can set a custom port using the `PORT` environment variable.

## Project Structure

```
├── package.json          # Project dependencies and scripts
├── server.js             # Main Express server file
├── public/               # Static files directory
│   └── index.html        # Main HTML interface
└── README.md            # This file
```

## Usage

Once the server is running, you can:

1. Visit `http://localhost:3000` to see the HTML interface
2. Test API endpoints using the interactive buttons
3. Make direct requests to the API endpoints using curl or any HTTP client

Example curl commands:

```bash
curl http://localhost:3000/api/hello
curl http://localhost:3000/api/text
curl http://localhost:3000/health
```
