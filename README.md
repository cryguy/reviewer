# reviewer

A self-hosted GitHub bot that automatically reviews pull requests using a multi-agent AI pipeline (orchestrator + Codex + Claude).

## Architecture Overview

When a whitelisted user comments `@bot review` on a pull request, the bot:

1. **Polls** GitHub for new trigger comments (configurable interval)
2. **Enqueues** the PR into a SQLite-backed work queue
3. **Orchestrator** (LLM via NanoGPT API) coordinates the review using tool calls
4. **Codex agent** clones the repo and performs deep code analysis in a sandbox
5. **Claude agent** reads files and searches code for additional context
6. **Posts** a structured review comment back to the PR on GitHub
7. **Dashboard** (Bun HTTP server) exposes run history and queue status

For full architecture details see the project specification.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Claude CLI](https://github.com/anthropics/claude-code) (for the Claude agent)
- [Codex CLI](https://github.com/openai/codex) (for the Codex agent)
- A GitHub Personal Access Token with `repo` and `read:user` scopes
- A [NanoGPT](https://nano-gpt.com) API key for the orchestrator model

## Quick Start

```bash
# 1. Clone and install dependencies
git clone https://github.com/your-org/reviewer
cd reviewer
bun install

# 2. Copy and fill in the config
cp config.example.json config.json
# Edit config.json with your credentials (see Configuration below)

# 3. Start the bot
bun start
```

The dashboard will be available at `http://localhost:3000` (or the port configured in `dashboard.port`).

## Configuration

Copy `config.example.json` to `config.json` and fill in the values:

### `bot`

| Field | Description |
|-------|-------------|
| `githubUsername` | The GitHub username the bot is logged in as |
| `githubPAT` | Personal Access Token with `repo` scope |
| `pollIntervalSeconds` | How often to poll GitHub for new comments (default: 30) |
| `runTimeoutMinutes` | Max time a review run may take before being killed (default: 15) |
| `cloneBasePath` | Directory for temporary repo clones; `null` uses the system temp dir |
| `maxToolLoopSteps` | Maximum orchestrator tool-call iterations per run (default: 20) |

### `orchestrator`

| Field | Description |
|-------|-------------|
| `nanogptApiKey` | API key for the NanoGPT inference endpoint |
| `model` | Model ID to use for the orchestrator (e.g. `moonshotai/kimi-k2.5:thinking`) |
| `systemPrompt` | Global system prompt override; `null` uses the hardcoded default |
| `repoOverrides` | Per-repo or per-branch system prompts — keys are `owner/repo` or `owner/repo:branch`, glob patterns supported |

### `agents`

| Field | Description |
|-------|-------------|
| `agents.codex.model` | Codex model ID |
| `agents.codex.reasoningEffort` | `low`, `medium`, or `high` |
| `agents.codex.sandboxMode` | `read-only` or `full` |
| `agents.claude.model` | Claude model ID |
| `agents.claude.allowedTools` | List of tools Claude may call (default: `["Read","Glob","Grep"]`) |
| `agents.claude.permissionMode` | Claude permission mode (default: `bypassPermissions`) |

### `whitelist`

Array of GitHub usernames allowed to trigger reviews by commenting `@bot review`.

### `dashboard`

| Field | Description |
|-------|-------------|
| `port` | HTTP port for the dashboard (default: 3000) |
| `auth` | Map of `username → password` for Basic Auth |

## Dashboard

Once running, open `http://localhost:<port>` in your browser. Log in with any credential pair from `dashboard.auth`. The dashboard shows:

- Live queue status (pending / running)
- Run history with status, duration, and cost
- Full review output and agent logs per run

## Development

```bash
# Run with hot reload
bun dev

# Type-check without emitting
bun typecheck

# Run tests
bun test
```

## Deployment

### PM2

```bash
npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
```

### Docker

```bash
docker build -t reviewer .
docker run -d \
  -v ./config.json:/app/config.json \
  -p 3000:3000 \
  reviewer
```

### Binary (single executable)

```bash
bun run build
# Produces ./reviewer — copy to server and run directly
./reviewer
```

## Security Note

> **Deploy the dashboard behind a TLS reverse proxy (nginx/caddy) — Basic Auth sends credentials unencrypted over HTTP.**

Example nginx snippet:

```nginx
server {
    listen 443 ssl;
    server_name reviewer.example.com;

    ssl_certificate     /etc/letsencrypt/live/reviewer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reviewer.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```
