# Render deployment notes for Skulx Discord Bot

## Configure the service

- Create a **Web Service** connected to this GitHub repository.
- Select **Docker** as the runtime.
- Use branch `main` and Dockerfile path `./Dockerfile`.
- Add `DISCORD_TOKEN` as a secret environment variable. Add `PASTEFY_API_TOKEN` only if Pastefy is used. Add any other variables required by your configuration.
- Render sets `PORT` automatically; the bot now listens on `0.0.0.0:$PORT` and provides `/health`.

## Important free-tier limitation

Render's free Web Service can spin down after 15 minutes without incoming HTTP traffic. The health endpoint lets Render serve HTTP requests, but it does **not** guarantee the Discord bot remains online 24/7. Do not use paid Background Worker settings if you need to keep the deployment free.

## Secrets

Never commit `.env` files, Discord tokens, or API keys. Keep secrets in Render's Environment settings.


## Added recovery engines

- `.gv11d` — Goofyscator V11 BETA-1. The `.deobf` selector includes it as a primary option. It reports failure rather than presenting diagnostic JSON as recovered Lua.
- `.lph151` — Luraph V15.1, installed as a separate backend and kept distinct from Luraph V15 Version 1 / Version 2.
- Goofyscator native Luau compile validation is skipped only when its bundled Linux runtime is unavailable; recovery remains best-effort and output should be reviewed.
