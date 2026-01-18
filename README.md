# OpenCode iFlow Auth Plugin
[![npm version](https://img.shields.io/npm/v/@zhafron/opencode-iflow-auth)](https://www.npmjs.com/package/@zhafron/opencode-iflow-auth)
[![npm downloads](https://img.shields.io/npm/dm/@zhafron/opencode-iflow-auth)](https://www.npmjs.com/package/@zhafron/opencode-iflow-auth)
[![license](https://img.shields.io/npm/l/@zhafron/opencode-iflow-auth)](https://www.npmjs.com/package/@zhafron/opencode-iflow-auth)

OpenCode plugin for iFlow.cn providing access to Qwen, DeepSeek, Kimi, GLM, and iFlow ROME models with dual authentication support.

## Features

- Dual authentication: OAuth 2.0 (PKCE) and API Key support.
- Multi-account rotation with sticky and round-robin strategies.
- Automated token refresh and rate limit handling with exponential backoff.
- Native thinking mode support for GLM-4.x models.
- Configurable request timeout and iteration limits to prevent hangs.
- Automatic port selection for OAuth callback server to avoid conflicts.

## Installation

Add the plugin to your `opencode.json` or `opencode.jsonc`:

```json
{
  "plugin": ["@zhafron/opencode-iflow-auth"],
  "provider": {
    "iflow": {
      "models": {
        "iflow-rome-30ba3b": {
          "name": "iFlow ROME 30B",
          "limit": { "context": 256000, "output": 64000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "qwen3-coder-plus": {
          "name": "Qwen3 Coder Plus",
          "limit": { "context": 1000000, "output": 64000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "qwen3-max": {
          "name": "Qwen3 Max",
          "limit": { "context": 256000, "output": 32000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "qwen3-vl-plus": {
          "name": "Qwen3 VL Plus",
          "limit": { "context": 256000, "output": 32000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "qwen3-235b-a22b-thinking-2507": {
          "name": "Qwen3 235B Thinking",
          "limit": { "context": 256000, "output": 64000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "kimi-k2": {
          "name": "Kimi K2",
          "limit": { "context": 128000, "output": 64000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "kimi-k2-0905": {
          "name": "Kimi K2 0905",
          "limit": { "context": 256000, "output": 64000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "glm-4.6": {
          "name": "GLM-4.6 Thinking",
          "limit": { "context": 200000, "output": 128000 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "deepseek-v3": {
          "name": "DeepSeek V3",
          "limit": { "context": 128000, "output": 32000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "deepseek-v3.2": {
          "name": "DeepSeek V3.2",
          "limit": { "context": 128000, "output": 64000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "deepseek-r1": {
          "name": "DeepSeek R1",
          "limit": { "context": 128000, "output": 32000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        },
        "qwen3-32b": {
          "name": "Qwen3 32B",
          "limit": { "context": 128000, "output": 32000 },
          "modalities": { "input": ["text"], "output": ["text"] }
        }
      }
    }
  }
}
```

## Setup

1. Run `opencode auth login`.
2. Select `Other`, type `iflow`, and press enter.
3. Choose authentication method:
   - **OAuth 2.0**: Follow browser flow for secure token-based authentication.
   - **API Key**: Enter your iFlow API key (starts with `sk-`).
4. Configuration template will be automatically created at `~/.config/opencode/iflow.json` on first load.

## Configuration

The plugin supports extensive configuration options. Edit `~/.config/opencode/iflow.json`:

```json
{
  "default_auth_method": "oauth",
  "account_selection_strategy": "round-robin",
  "auth_server_port_start": 8087,
  "auth_server_port_range": 10,
  "max_request_iterations": 50,
  "request_timeout_ms": 300000,
  "enable_log_api_request": false
}
```

### Configuration Options

- `default_auth_method`: Default authentication method (`oauth`, `apikey`)
- `account_selection_strategy`: Account rotation strategy (`sticky`, `round-robin`)
- `auth_server_port_start`: Starting port for OAuth callback server (1024-65535)
- `auth_server_port_range`: Number of ports to try (1-100)
- `max_request_iterations`: Maximum loop iterations to prevent hangs (10-1000)
- `request_timeout_ms`: Request timeout in milliseconds (60000-600000ms)
- `enable_log_api_request`: Enable API request/response logging (errors always logged)

### Environment Variables

All configuration options can be overridden via environment variables:

- `IFLOW_DEFAULT_AUTH_METHOD`
- `IFLOW_ACCOUNT_SELECTION_STRATEGY`
- `IFLOW_AUTH_SERVER_PORT_START`
- `IFLOW_AUTH_SERVER_PORT_RANGE`
- `IFLOW_MAX_REQUEST_ITERATIONS`
- `IFLOW_REQUEST_TIMEOUT_MS`
- `IFLOW_ENABLE_LOG_API_REQUEST`

## Storage

**Linux/macOS:**
- Credentials: `~/.config/opencode/iflow-accounts.json`
- Plugin Config: `~/.config/opencode/iflow.json`

**Windows:**
- Credentials: `%APPDATA%\opencode\iflow-accounts.json`
- Plugin Config: `%APPDATA%\opencode\iflow.json`

## Thinking Models

GLM-4.x models automatically enable thinking mode with special configuration:

```typescript
// GLM-4.6 automatically add:
{
  "chat_template_kwargs": {
    "enable_thinking": true,
    "clear_thinking": false
  }
}
```

## Disclaimer

This plugin is provided strictly for learning and educational purposes. It is an independent implementation and is not affiliated with, endorsed by, or supported by iFlow.cn. Use of this plugin is at your own risk.

Feel free to open a PR to optimize this plugin further.
