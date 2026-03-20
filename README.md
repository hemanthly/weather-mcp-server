# Weather MCP Server

Real-time weather for any city using the **Open-Meteo API** — free, no API key needed.

## Tools available to Claude

| Tool                    | What it does                    |
| ----------------------- | ------------------------------- |
| `get_current_weather`   | Current conditions for any city |
| `get_forecast`          | 1–7 day forecast for any city   |
| `get_weather_by_coords` | Weather by latitude/longitude   |

## Setup (5 minutes)

### 1. Install and build

```bash
npm install
npm run build
```

### 2. Connect to Claude Desktop

Open your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this (replace the path with your actual folder path):

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/weather-mcp/build/index.js"]
    }
  }
}
```

### 3. Restart Claude Desktop

Quit and reopen Claude Desktop. You should see a hammer icon — that means MCP is connected.

### 4. Test it

Ask Claude:

- "What's the weather in Hyderabad?"
- "Give me a 5-day forecast for Mumbai"
- "What's the weather at 17.385, 78.4867?"

## Debug with MCP Inspector

```bash
npm run inspector
```

This opens a browser UI where you can test tools directly without Claude Desktop.

## Notes

- Uses `console.error()` for logging — `console.log()` would corrupt the MCP stdio stream
- No API key needed — Open-Meteo is free for non-commercial use
- Works for any city worldwide
