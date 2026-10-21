# Goofyscator V11 BETA-1 source recovery

`.gv11d` accepts text, URLs, attachments and replied-to sources. `.do` detects
V11 BETA-1 and routes here. Supported inputs return syntax-checked
`deobfuscated.lua`, using the normal bot header and raw-link delivery.
Unsupported inputs return explicitly labelled analysis JSON, never pretend Lua.
`.ud` routing is unchanged. This is not a guarantee of support for every V11 build.

## Semantic readability pipeline

The actual `.gv11d` / `.do` path now applies `readability.mjs` after the existing
CFG/VM recovery and before formatting/validation. It does not rewrite a known
sample or match its URLs, game IDs, strings or register numbers.

- Lexical symbol tables distinguish declarations, parameters, shadowing,
  closure captures, repeat scopes and property names. All renaming is per
  binding, with collision protection against existing locals and globals.
- Def/use and reaching-definition recovery in the IR are complemented by
  bounded AST passes for immutable constants/copies, safe single-use expression
  folding, dead stores and local-register lifetime splitting. Lifetime splits
  are blocked by earlier captures and bounded below Luau's register limit.
  Small non-escaping declaration regions get lexical `do` scopes when crowded
  functions need to release registers; declarations are never hoisted.
- Proven SELF/CALL sequences and immutable local method receivers recover
  colon calls. Reassigned receivers/method snapshots and observable lookup
  order are preserved. Range edits are atomic, and parser postfix ranges are
  normalized against lexer delimiters.
- Wrapper cells keep their shared lexical identity through CLOSE without
  boxing the whole bundle. Repeated strings are no longer hoisted into a
  synthetic string pool. Adjacent one-result calls can initialize scalar cells
  directly rather than creating an extra temporary.
- Roblox class/member metadata supplies service/property/signal/result hints.
  `GetService` names are taken from the argument, not a small service whitelist.
  `cloneref`, indirect method aliases, constructors, require results, exports,
  callbacks, getter returns, call-site arguments and loop collections provide
  naming evidence. Optional/union hints are recorded; they are not assertions
  or emitted type annotations. Ambiguous roles retain conservative names.
- Pure unused values, equality negations, unreachable terminal suffixes and
  safe contiguous table fields are simplified. Global/property reads are not
  assumed pure. Only closed, unmodified, non-escaping Lua identity wrappers
  are removed; global LPH/executor macros are never blindly erased.
- Every successful result is parsed and compiled by the native Luau runtime.
  The compilation checker treats recovered text as data and never calls the
  compiled payload. Syntax/compile checks alone do not establish runtime
  equivalence of user scripts.

The safe passes stop at a fixed point or six rounds. This extends the existing
IR/CFG pipeline; it is not a complete Luau type checker or a guarantee of
recovering original names, all SSA lifetimes or every dynamic alias. Some
temporaries/branches are deliberately retained when proof is insufficient.

Additional tests:

```text
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-readability.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-source-recovery.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-extraction.mjs
```

The 2,718,254-byte attachment audited in
`analysis/goofyscator-v11/attachment-30f6eed0/vm-analysis.md` now passes full
source emission and Luau syntax/compile-only validation (503 prototypes, 5,786 decoded
string calls), without a register-VM fallback or unresolved goto. Its payload
was not executed; behavioral comparisons use only the generated safe fixtures.

Implemented:

- Constant concatenated wrapper keys and nested function parentheses.
- Function expressions hidden behind constant table/index wrappers.
- V11's per-build six-character encrypted dispatch rings.
- Rolling seed, feedback, tag and dispatch-ID extraction from the builder source.
- Complete handler source association, with duplicate and missing-map checks.
- Primary decode bridge and runner-cache discovery.
- Bounded, isolated Luau extraction of lazy validator instruction tables, with
  byte strings exported as exact hex and floats as 17-digit numbers. This stops
  before the validator's opcodes execute; no runtime logger output is used.
- Cached/forwarding handler references associated with their original families
  where exact runtime function identity establishes the match. Unmatched
  function references remain explicitly null, not guessed.
- Empty protected streams fail explicitly rather than being called recovered.
- Protected-frame capture, recursive prototype extraction and dispatch-wrapper /
  superinstruction expansion. The locked handler proxy needs raw shadow entries
  for collector installation; ordinary assignments are silently ignored by V11.
- Constant preflight/counter handshakes and exact forwarding-metadata identity
  checks. Constants are decrypted by the decoder's own private routines, not by
  guessing values or collecting a behavior trace.
- VM-to-IR lowering, pure string-decoder folding, verified protection-envelope
  removal, environment-proxy elimination and source emission. Captured-variable
  writes, fixed array constructors, comparison branches and open vararg returns
  have V11-specific lowering.
- Compound table arithmetic writes and flag-controlled nil branches. Arithmetic
  selector constants are discovered from each handler's AST, not fixture output.
- CFG-liveness-checked narrowing of open calls feeding fixed wrapper packets.
  Live extra results on any branch prevent narrowing. Constructor identity and
  reused record-field strings are preserved during source emission.
- Native function factories (including captured getter/setter closures) and
  key-dependent encrypted string functions. Native bodies are read statically
  from the wrapper, never invoked during recovery. Wrong-key behavior remains
  in the recovered keyed function. Unknown source calls such as an undefined
  `GUF_ENCNUM` are preserved rather than replaced with invented results.
- AST-verified destination transforms, operand descriptor getters and operand
  kinds. Arithmetic is interpreted by a restricted metadata evaluator; target
  handler code is not executed for this step. Analysis-only operands remain
  labelled encrypted unless the source recovery path resolves them.
- A bounded whitelist-host path through the validator to its own payload callback.
  The first VM frame after that callback is captured before dispatch. It is
  labelled `payload-handoff` until instruction/prototype extraction and lifting
  finish. The first capture is preserved even if the target
  catches the stop signal and tries another callback.

The four locally generated V11 fixtures contain 56–59 families and 86–91 IDs.
Both quotient/remainder orientations and randomized alphabets/mixer constants
are decoded. These are derived from their actual builder constants, not from a known plaintext
payload. Discovery never executes the obfuscated script or recovered Lua.

Validator extraction currently yields 294–297 entries across five site-generated
fixtures. These are validator bytecode, **not** recovered protected user source.
The anti-tamper-off comparison fixture still uses the V11 internal validator.
The callback-handoff path uses only the private whitelist host, not an environment
logger or Roblox client. Failure to reach a callback is reported in the JSON;
it does not turn validator data into recovered source.

Twenty-one site-generated/known-source comparisons now recover readable Lua and execute with the same
output as their known original sources: Hello World, closures with mutable
captures, conditional/numeric/generic loops, nil-preserving varargs and pcall,
and anti-tamper disabled. Eight new fixtures cover every site-offered loader depth
(1–5), compound assignments, signal-style callbacks, method calls, and configurations
with string encryption, anti-tamper, local/function proxies and flattening disabled.
Their exact settings are recorded in `../analysis/goofyscator-v11/generated-settings.json`.
The larger attached GUI sample extracts 46 prototypes and 204 decrypted strings;
its output is syntax-checked only, not executed in Roblox or claimed behavior-verified.
The malformed-opcode regression returns analysis-only.
Seven stress builds at VM depths 1 and 5 use 16, 64, 128 and 512 independently
mutable worker closures. The largest has 121,094 bytes of clear source and
1,088,432 bytes of obfuscated input, recovering 1,047 prototypes and 1,051 strings.
The macro comparison also checks a native closure updating its captured variable.
`latest-stress-report.json` records actual sizes, timing, and behavior results;
`stress-settings.json` records the generation settings. These repeated-worker
fixtures measure scale; they do not substitute for coverage of every language feature.
These tests are not a proof for arbitrary programs or other V11 variants.
Recovery rejects unresolved instructions, unexpanded blocks, unresolved goto
control flow, compatibility-register-VM fallbacks and invalid Luau syntax.
Original identifier names are not recoverable; local names are inferred.
The inherited upstream runtime probe/host file loader is never invoked.

Default failure output is a small recovery report, not VM tables or recovered
Lua. Full `layout`, `disassembly`, and `payloadHandoff` diagnostics require the
explicit local CLI flag `--full-analysis`; the bot never enables it. Python
delivery also withholds diagnostic artifacts over 64 KiB.

Source recovery additionally uses CFG-proven open call/constructor/return
expressions, native loop exits and continues, and fresh per-iteration captured
bindings. Missing branch targets fail rather than becoming invented returns.
Call-frame cleanup also revisits already reconstructed calls, checking register
liveness and observable evaluation order before absorbing aliases. It does not
match particular game IDs, API names, URLs or expected payload strings. Wrapper
initializers needed by user code survive guard removal until their uses are
semantically lowered. Branch-only aliases are consumed once, not evaluated in
both an assignment and the condition. Inferred names and necessary temporaries
may remain; syntax validation alone is not a runtime-equivalence proof.
See `../analysis/goofyscator-v11/attachment-30f6eed0/vm-analysis.md` for the
two-stage VM investigation and `final-recovery-report.json` beside it for the
large attachment's actual recovery status.

Reference: MIT-licensed `memcpython/lua-deobfuscators`, pinned to
`d14f8520a8191a71f0049ea6af82da252d8a7c08`, under
`../deobfuscator/upstream/goofy-review/`. Its license is retained there. The V10
wrapper parser, metadata normalization, IR optimizer and source emitter are reused
with local V11 adaptations. Reference modules also have narrowly scoped extensions
for upvalue writes, expression evaluation, vararg emission and generic-loop joins.
The V11 ring decoder, layout discovery and recovery orchestration are local.

Run from `allthing`:

```text
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-discovery.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-capture.mjs --export
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-layout.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-extraction.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-open-results.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-dce.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-source-recovery.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-normalizer.mjs
node obf/node_modules/tsx/dist/cli.mjs goofyscator/test-corpus.mjs
py -3 -m unittest goofyscator.test_runner deobfuscator.test_commands
node obf/node_modules/tsx/dist/cli.mjs goofyscator/analyze.mjs analysis/goofyscator-v11/hello.obfuscated.lua
```

Extraction additionally needs the existing `deobfuscator/deobf/bin/luau` runtime.
The subprocess has a size-based 15–100 second timeout, a 32 MB output cap, a 100,000
instruction limit and a bounded metadata exporter.
The metadata-node budget scales from one to four million visits with input size;
the recursion-depth bound remains 64. Export and process-output limits fail closed.
No filesystem/network APIs are exposed to decoder code. This is not a claim of complete OS-level isolation.

`random.luau` reuses the 64-bit limb PCG32 algorithm already present in the
project's offline runtime; it is a small private extraction-host helper, not an
implementation of all Roblox APIs.
