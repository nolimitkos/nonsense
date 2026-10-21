GOOFYSCATOR DEOBFUSCATOR — extracted source
===========================================

Recovered from `logged-by-kfc-1.0.5-setup.exe` during static analysis on 2026-10-18.

Provenance chain
----------------
logged-by-kfc-1.0.5-setup.exe   (.NET 8 stub, sha256 430f95f0…f743)
  -> install-core.exe           (NSIS 3.04, sha256 d919bd97…73cc)
    -> resources/engines/engines.pack   (sha256 35462b9e…7fd3)
       AES-256-GCM (key shipped in app.asar at assets/engine-key.json)
       -> gzip -> JSON[{file, sha256, data(base64)}]
       -> 1,137 files, every per-file SHA-256 verified OK

Nothing here was executed. These are files read out of the archive as data.


Layout
------
The original `engines/` root is preserved so that every relative import
resolves exactly as it does in the shipped product. Verified: 205/205
relative specifiers resolve, 0 broken.

  engines/goofyscator/                        21 files, 212 KB
      THE ACTIVE ENGINE. Goofyscator V11 BETA-1 source recovery.
      This is what the app's `.gv11d` command runs, and what `.do`
      (auto-detect) routes to when it identifies V11 BETA-1.
      Entry points: cli.mjs (CLI), runner.py (called by the desktop app),
      deobfuscate.mjs (deobfuscateV11), analyze.mjs (analyzeV11).

  engines/deobfuscator/upstream/goofy-review/goofyscator/
                                              118 files, 888 KB
      THE UPSTREAM LIBRARY ("goofy-review"). The tree above is a set of
      thin adapters over this one — nearly every active-engine file
      imports from here. src/ is organised as:
        core/ decode/ discovery/ emit/ eval/ ir/ lift/ opcodes/
        optimize/ parser/ runtime/ source/ validate/

  engines/ad/lift/readable-parser.ts          1.3 KB
      Shared Lua/Luau parser wrapper. Loads luaparse and preserves source
      offsets while letting AST passes handle Luau's `continue` keyword
      (lexes for `continue` tokens, rewrites to `break   ` at identical
      offsets, then restores ContinueStatement nodes).
      NOTE: imported as './readable-parser.js' — TypeScript/tsx resolves
      the .js specifier to the .ts file. Same for all .ts files here.

  engines/ad/lift/api-metadata.ts             5 KB
      Roblox class/member/enum metadata used for semantic naming hints
      (GetService names, properties, signals, result types).

  engines/ad/lift/polish.ts                   9.7 KB
      Post-recovery polish pass, imported by goofyscator/deobfuscate.mjs.

  engines/dumper/fixtures/roblox_api_schema.json    1.4 MB
      The Roblox API dump that api-metadata.ts reads. Version
      "version-76e1a02649ad4f35", generated 2026-10-04.

  engines/obf/node_modules/luaparse/          84 KB
      Third-party Lua parser (MIT). Required by readable-parser.ts.


Running it
----------
Needs Node >= 18 and tsx. In the shipped app tsx is bundled at
engines/obf/node_modules/tsx (not included here — install it yourself):

    npm i tsx
    npx tsx engines/goofyscator/cli.mjs <input.lua>

The app invokes it via engines/goofyscator/runner.py, which shells out to
the bundled tsx against desktop/backend/engine.mjs.


What is NOT included
--------------------
- The bundled runtimes (Node 92 MB, Python 3.14, .NET 9, JRE) and the
  native Luau binaries. capture.mjs / deobfuscate.mjs call `spawnSync`
  on a native Luau interpreter for syntax/compile validation; without it
  those validation steps will fail, though the static recovery passes
  (discovery, lift, optimize, readability) are pure JS and should run.
- The rest of ad/lift (34 MB) — only the three files the goofyscator
  import graph actually reaches are included. Its bulk is Aqua test
  fixtures (aqua1..6.full.lua + disassembly JSON), not code.
- obf/node_modules/tsx and the other bundled toolchain packages.


Security notes (from the wider analysis)
----------------------------------------
- No network imports anywhere in these 148 files. The only process
  spawning is `spawnSync` to bundled local binaries.
- normalizer.mjs explicitly forbids `loadfile`, `dofile`, `io` and
  `require` in the source it handles.
- The README is candid about limits: "Syntax/compile checks alone do not
  establish runtime equivalence of user scripts", and the audited 2.7 MB
  sample's "payload was not executed; behavioral comparisons use only the
  generated safe fixtures."
