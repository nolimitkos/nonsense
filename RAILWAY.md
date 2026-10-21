# Railway deployment

1. Push this folder to GitHub.
2. Create/link a Railway service to the repository.
3. Railway will use the included Dockerfile.
4. Add `DISCORD_TOKEN` as a Railway environment variable.
5. Add `PASTEFY_API_TOKEN` using your Pastefy API key. Do not commit the key to GitHub.
6. Keep `PASTEFY_API_URL=https://pastefy.app/api/v2/paste`.
7. Redeploy after changing the repository.

The Docker build compiles Linux `luau` and `luau-ast` from Luau 0.709 because the supplied deobfuscator archive contains Windows `.exe` binaries while Railway uses Linux. Third-party engines are installed lazily on first use so an optional engine failure cannot fail the whole Docker build.

## Pastefy
The bot uses Pastefy API v2 at `https://pastefy.app/api/v2/paste`.

## Optional environment variables
- `PREFIX` — default `.`
- `MAX_UPLOAD_MB` — default `8`
- `JOB_TIMEOUT_MS` — default `900000`
- `MAX_PREVIEW_CHARS` — default `3500`
- `MAX_JOBS` — default `2`
- `PASTEFY_API_TOKEN` — Pastefy API key
- `PASTEFY_API_URL` — default `https://pastefy.app/api/v2/paste`
- `PASTEFY_AUTH_SCHEME` — optional, e.g. `Bearer`
