# Skulx Discord Bot

## Railway environment

Required:
- `DISCORD_TOKEN`

Pastefy:
- `PASTEFY_API_TOKEN` (recommended)
- `PASTEFY_API_KEY` or `PASTEFY_TOKEN` are accepted aliases
- `PASTEFY_API_URL=https://pastefy.app/api/v2/paste`
- `PASTEFY_AUTH_SCHEME=Bearer`

The bot does not store the Pastefy token in source. Pastefy API v2 uses `POST /paste` under the v2 base URL with bearer authentication.

## Commands

- `.help` — command list
- `.deobf` — interactive deobfuscator selector
- `.lph` — choose Luraph V15 Version 1, V15 Version 2, or V14.7
- `.luraph` — V14.7 compatibility alias
- `.mv` — MoonVeil 1.4.5
- `.luaobf` — choose Chaotic Good / Chaotic Evil
- `.luast` — LUAST deobfuscator
- `.flow` — FlowAuth loader/deobfuscation pipeline
- `.hl` — hide.lat lite deobfuscator
- `.luarmor` — authorized Luarmor fetcher
- `.ib` — IronBrew2
- `.goofy` — Goofyfuscator V10
- `.ms` — MoonSec V2
- `.iv` — IronVeil V1
- `.hercules` — Hercules
- `.7f` — 77fuscator
- `.promdeobf` — Prometheus
- `.wrd` — WeAreDevs Prometheus-family
- `.detect` — obfuscator detection
- `.get` — direct/raw fetching; HTML is rejected, with an optional Luarmor fallback for Luarmor loader URLs
- `.decode` — non-executing encoding decoder
- `.beautify` / `.beutify` — formatting only
- `.rename` — identifier cleanup

All deobfuscation results receive a Skulx Cli header, are attached to Discord, and are uploaded to Pastefy when the API token is configured.
