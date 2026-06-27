# Contributing

Thanks for considering a contribution to Project Forge.

## Development setup

```bash
git clone https://github.com/ankush-kaura/project-forge.git
cd project-forge
cp .env.example .env
docker compose up -d --build
```

For local tests outside Docker:

```bash
cd backend && npm ci && npm test -- --run && npm run build
cd ../frontend && npm ci && npm test -- --run && npm run build
cd ../telegram-bot && python -m pip install pytest && pytest -q
```

## Pull request checklist

- Keep changes focused and small.
- Update docs when behavior or configuration changes.
- Do not commit `.env`, API keys, tokens, database dumps, generated workspaces, build outputs, or TLS private keys.
- Run the relevant tests/builds before opening a PR.
- Include screenshots or terminal output for UI/runtime changes when useful.

## Coding notes

- Backend custom product-flow routes live mostly in `backend/src/index.ts`.
- LLM provider routing lives in `backend/src/lib/llm.ts`.
- GitHub repo creation/push logic lives in `backend/src/lib/github.ts`.
- Generated workspaces should stay outside the watched Strapi app tree (`/forge-builds` in Docker).
- Mock mode is allowed for local demos only; production/submission demos should use a real provider and show `/api/forge/health`.

## Reporting bugs

Please include:

- Steps to reproduce
- Expected vs actual behavior
- Logs or screenshots
- Output from `/api/forge/health` with secrets removed
- Environment: Docker/Node/Python versions
