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


## Added recovery engines

- `.gv11d` — Goofyscator V11 BETA-1. The `.deobf` selector includes it as a primary option. It reports failure rather than presenting diagnostic JSON as recovered Lua.
- `.lph151` — Luraph V15.1, installed as a separate backend and kept distinct from Luraph V15 Version 1 / Version 2.
- Goofyscator native Luau compile validation is skipped only when its bundled Linux runtime is unavailable; recovery remains best-effort and output should be reviewed.

## Luraph version routing

- `.lph` opens a selector for V15 Version 1, V15 Version 2, V15.1, and V14.7/V14.8/V14.9.
- `.lph147`, `.lph148`, and `.lph149` force the matching bundled V14 backend.
- `.lph151` uses the separate V15.1 engine.
- V15 Version 1 continues to use the original `Deobfuscator/deob.js` pipeline; it is not routed through V15.1.
- Text outputs start with `-- This file was deobfuscated by Skulx Cli` followed by a blank line.

The V14.7/V14.8/V14.9 backend is bundled under `Engines/thirdparty/luraph-v14-7-14-8-14-9`. The Docker build places the Linux Luau runtime and AST executable in that backend's `bin/` directory.
