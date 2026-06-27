# Project Forge User Guide

Project Forge is a self-hosted workspace for capturing ideas, analysing them with configurable AI providers, prioritising them, brainstorming architecture, and generating GitHub-ready starter repositories.

## Access

After local startup:

| Service | URL |
|---|---|
| Web app | `http://localhost:3000` |
| Strapi admin | `http://localhost:1337/admin` |
| GraphQL | `http://localhost:1337/graphql` |
| Health | `http://localhost:1337/api/forge/health` |

For production, replace `localhost` with your deployed domain and configure `.env` accordingly.

## Core pages

| Page | Purpose |
|---|---|
| `/dashboard` | Stats, top priorities, recent ideas. |
| `/ideas` | Search/filter ideas with grid and list views. |
| `/ideas/new` | Capture a new idea. |
| `/ideas/:id` | View analysis, priority, repo, and notes. |
| `/ideas/:id/brainstorm` | Architecture, Q&A, and build workflow. |
| `/priorities` | Ranked idea leaderboard. |
| `/vault` | Notes across ideas. |
| `/health` | AI/GitHub/deploy status. |

## Idea workflow

```text
captured -> analyzed -> prioritized -> brainstorming -> building -> launched
                                               \-> failed / archived
```

Typical path:

1. Create an idea.
2. Run AI analysis.
3. Set priority scores.
4. Start brainstorm.
5. Choose architecture.
6. Approve architecture and answer clarifying questions.
7. Generate build layers / starter repo.
8. Track notes and refinements.

## Telegram bot setup

1. Create a Telegram bot with BotFather.
2. Add values to `.env`:

   ```env
   TELEGRAM_TOKEN=your-bot-token
   ALLOWED_USERS=comma-separated-telegram-user-ids
   STRAPI_URL=http://backend:1337
   ```

3. Start/restart the service:

   ```bash
   docker compose up -d --build telegram-bot
   ```

### Bot commands

| Command | Purpose |
|---|---|
| `/start` | Help. |
| `/new <title> — <description>` | Create idea. |
| `/list` | Show recent ideas. |
| `/analyze <id>` | Trigger AI analysis. |
| `/brainstorm <id>` | Start architecture brainstorm. |
| `/choose <session-id> <number>` | Select architecture. |
| `/approve_arch <session-id>` | Approve architecture and generate questions. |
| `/start_qa <session-id>` | Begin Q&A. |
| `/status <id>` | Show idea/session status. |

## Docker management

```bash
# Start all services
docker compose up -d --build

# View logs
docker compose logs -f

# Restart one service
docker compose restart backend

# Stop everything
docker compose down
```

## Testing

```bash
cd backend && npm ci && npm test -- --run && npm run build
cd ../frontend && npm ci && npm test -- --run && npm run build
cd ../telegram-bot && python -m pip install pytest && pytest -q
```

## Provider status

Use the health endpoint before demos/submissions:

```bash
curl http://localhost:1337/api/forge/health
```

It reports:

- analysis provider/model/configured
- codegen provider/model/configured
- GitHub token status without exposing the token
- deploy mode
- mock mode

For public demos, prefer `MOCK_MODE=0` with a real configured provider.
