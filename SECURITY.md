# Security Policy

## Supported versions

Project Forge is currently an early open-source project. Security fixes target the `main` branch.

## Reporting a vulnerability

Please do **not** open a public issue for sensitive vulnerabilities.

Report privately to the maintainer:

- Ankush Kaura
- GitHub: open a private vulnerability report if the repository supports it

Include:

- Affected component/path
- Reproduction steps
- Impact
- Suggested fix, if known

## Secret handling

Never commit:

- `.env` or `.env.*` files other than `.env.example`
- API keys or OAuth tokens
- GitHub PATs
- Telegram bot tokens
- Database dumps
- TLS private keys or certificates from `nginx/ssl/`
- Generated project workspaces containing user data

Public examples should use placeholders only.

## Deployment notes

`deploy.sh` can generate self-signed TLS files under `nginx/ssl/`. These files are local deployment artifacts and are ignored by Git. Use a real ACME/reverse-proxy setup for production internet exposure.
