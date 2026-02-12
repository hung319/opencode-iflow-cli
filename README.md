# OpenCode iFlow CLI Plugin

[![npm version](https://img.shields.io/npm/v/@hung319/opencode-iflow-cli)](https://www.npmjs.com/package/@hung319/opencode-iflow-cli)
[![npm downloads](https://img.shields.io/npm/dm/@hung319/opencode-iflow-cli)](https://www.npmjs.com/package/@hung319/opencode-iflow-cli)
[![license](https://img.shields.io/npm/l/@hung319/opencode-iflow-cli)](https://www.npmjs.com/package/@hung319/opencode-iflow-cli)

OpenCode plugin for iFlow.cn providing access to Qwen, DeepSeek, Kimi, GLM, and iFlow ROME models with auto-configuration and headless OAuth support.

## Features

- **Auto-configuration**: Models are automatically configured, no manual setup needed.
- **Dual authentication**: OAuth 2.0 (PKCE) and API Key support.
- **Headless support**: Works in SSH, containers, and CI environments with manual code input.
- **Multi-account rotation**: Sticky and round-robin strategies for account selection.
- **Automated token refresh** and rate limit handling with exponential backoff.
- **Native thinking mode support** for GLM-4.x and DeepSeek R1 models.
- **Flexible OAuth**: Automatic browser redirect OR manual code input - both work!

## Installation

```bash
npm install -g @hung319/opencode-iflow-cli
```

Or add to your `opencode.json` with specific version:

```json
{
  "plugin": ["@hung319/opencode-iflow-cli@2.0.0"]
}
```

Then select **"iflow-oauth"** from the provider list when logging in (this is the enhanced iFlow with OAuth support).

That's it! Models are automatically configured. No manual provider configuration needed.

## Quick Start

### Interactive Mode (with browser)

```bash
opencode auth login
# Select: iflow-oauth → Enter  
# Choose: OAuth 2.0 or API Key
```

Browser will open automatically. Complete authentication and you're done!

### Headless Mode (SSH, CI, Containers)

```bash
opencode auth login
# Select: iflow-oauth → Enter
# Choose: OAuth 2.0
```

1. Open the displayed URL in your local browser.
2. Complete authentication on iFlow.cn.
3. Copy the callback URL or authorization code.
4. Paste it back into the terminal.

The plugin automatically detects headless environments and adapts accordingly.

## Configuration

Optional configuration file at `~/.config/opencode/iflow.json`:

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

| Option | Description | Default |
|--------|-------------|---------|
| `default_auth_method` | Auth method (`oauth`, `apikey`) | `oauth` |
| `account_selection_strategy` | Rotation strategy (`sticky`, `round-robin`) | `round-robin` |
| `auth_server_port_start` | OAuth callback server starting port | `8087` |
| `auth_server_port_range` | Number of ports to try | `10` |
| `max_request_iterations` | Max iterations to prevent hangs | `50` |
| `request_timeout_ms` | Request timeout in milliseconds | `300000` |
| `enable_log_api_request` | Enable request/response logging | `false` |

### Environment Variables

All config options can be overridden via environment variables:

```bash
export IFLOW_DEFAULT_AUTH_METHOD=oauth
export IFLOW_ACCOUNT_SELECTION_STRATEGY=round-robin
export IFLOW_AUTH_SERVER_PORT_START=8087
export IFLOW_MAX_REQUEST_ITERATIONS=50
export IFLOW_REQUEST_TIMEOUT_MS=300000
```

## Supported Models

Models are automatically configured when you install the plugin:

| Model | Context | Output | Features |
|-------|---------|--------|----------|
| `iflow-rome-30ba3b` | 256K | 64K | iFlow ROME 30B |
| `qwen3-coder-plus` | 1M | 64K | Qwen3 Coder Plus |
| `qwen3-max` | 256K | 32K | Qwen3 Max |
| `qwen3-vl-plus` | 256K | 32K | Vision support |
| `qwen3-235b-a22b-thinking-2507` | 256K | 64K | Thinking mode |
| `kimi-k2` | 128K | 64K | Kimi K2 |
| `kimi-k2-0905` | 256K | 64K | Kimi K2 0905 |
| `glm-4.6` | 200K | 128K | Thinking + Vision |
| `deepseek-v3` | 128K | 32K | DeepSeek V3 |
| `deepseek-v3.2` | 128K | 64K | DeepSeek V3.2 |
| `deepseek-r1` | 128K | 32K | Reasoning model |
| `qwen3-32b` | 128K | 32K | Qwen3 32B |

## Data Storage

**Linux/macOS:**
- Credentials: `~/.config/opencode/iflow-accounts.json`
- Config: `~/.config/opencode/iflow.json`

**Windows:**
- Credentials: `%APPDATA%\opencode\iflow-accounts.json`
- Config: `%APPDATA%\opencode\iflow.json`

## Thinking Models

### GLM-4.6

Variants with thinking budgets:

```json
{
  "model": "glm-4.6",
  "variant": "medium"
}
```

Available variants:
- `low`: 1024 thinking tokens
- `medium`: 8192 thinking tokens
- `max`: 32768 thinking tokens

### DeepSeek R1

```json
{
  "model": "deepseek-r1",
  "variant": "medium"
}
```

Same variant options as GLM-4.6.

## Headless Environment Detection

The plugin automatically detects headless environments via:
- `SSH_CONNECTION`, `SSH_CLIENT`, `SSH_TTY`
- `OPENCODE_HEADLESS`
- `CI`, `CONTAINER`
- Missing `DISPLAY` on Linux

In headless mode:
- OAuth URL is displayed for manual opening
- Browser auto-open is disabled
- Manual code input is prompted

## Links

- **NPM Package**: https://www.npmjs.com/package/@hung319/opencode-iflow-cli
- **GitHub Repository**: https://github.com/hung319/opencode-iflow-cli
- **Issues**: https://github.com/hung319/opencode-iflow-cli/issues

## License

MIT

## Disclaimer

This plugin is provided strictly for learning and educational purposes. It is an independent implementation and is not affiliated with, endorsed by, or supported by iFlow.cn. Use of this plugin is at your own risk.

Feel free to open a PR to optimize this plugin further.
