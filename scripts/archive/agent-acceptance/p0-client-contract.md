# Frozen client API contract replay

Scope: all **124 live entries** among the 125 original `client-api` IDs for `apps/web/src/api/{index,ai,logging,proxy}.ts` in the complete frozen ledger under `docs/acceptance/issue-257-258/8f30e6b/`. `gitTimeout.timeout` is retired and remains uncovered. The manifest pins both complete input files by SHA-256 and HEAD `8f30e6bcc0a4b7706c192896a73b87dc1a915ed9`.

## Replay

Requires installed workspace dependencies, Node 24 with `registerHooks`, and a writable `PI_SCRATCH_DIR`. Run from the repository root. The existing web `resolve-ts.mjs` is loaded; the additional loader transpiles TS/TSX and resolves domain/protocol/agent-client to **source**, not potentially stale `dist` output. This is execution, not a TypeScript typecheck or build.

```sh
node --import ./scripts/archive/agent-acceptance/p0-client-loader.mjs --test scripts/archive/agent-acceptance/p0-client-contract.test.mjs
node --test scripts/archive/agent-acceptance/p0-client-runner.test.mjs
OUT="$PI_SCRATCH_DIR/p0-client-evidence-124-$(date +%Y%m%d-%H%M%S)"
node scripts/archive/agent-acceptance/p0-client-runner.mjs "$OUT" scripts/archive/agent-acceptance/acceptance-mac-arm64.json
node scripts/archive/agent-acceptance/check-release-evidence.mjs \
  docs/acceptance/issue-257-258/8f30e6b/ledger.json \
  "$OUT/receipts.json" "$OUT/release-check.json" \
  scripts/archive/agent-acceptance/acceptance-mac-arm64.json
```

Use a **new**, nonexisting `p0-client-evidence-*` directory directly in the current session scratch on every replay. No new evidence histories are written under scripts. The final command is expected to exit **1**: it accepts these local proofs and counts 124 IDs, but the complete ledger still lacks 2634 IDs and all installation/platform/release gates. Never describe that exit as a release pass. Another supported target requires a suitable local-proof policy; never relabel the execution target.

## Independent oracles

- `p0-client-cases.mjs` preserves the first 63 literal original IDs; `p0-client-more-cases.mjs` supplies the remaining 61 live IDs. Each has an exact test name, explicit public invocation, independently written ordered host/method/params/options/resource, mock responses, and expected public return value. Static common fixtures/envelope helpers are allowed; no source inspection, coverage hits, reflection, or actual implementation outputs generate expectations.
- Every bound case tests an uninstalled rejection, successful response projection, and a `ProtocolError` failure. Analytics explicitly asserts the per-ID error return instead of falsely expecting rejection. Connection status/auth, proxy pending-reconnect/forwarding, repository registration aliases, scan paths, local/remote resource ownership, file tree/text projection, and prepared writes have concrete expected values.
- All 44 Git write cases plus the registered-file write case assert separate `repositories.prepareWrite` and `repositories.write` requests, a fixed prepared revision, exact positional arguments (including omitted-to-null serialization), execution timeout, and public return projection. Every such case also tests prepare rejection (no execution) and unknown execution outcome (no second write). Git writes query the task once with the original operation ID; file writes preserve the unknown-outcome error/cause and do not silently retry.
- Operation UUIDs are strictly checked as UUIDv4 and normalized **only** into the explicit `$operationId` fixture slot. Subsequent task lookups must use that same ID. Other payload fields are not relaxed. A task fixture can echo the already validated ID into its response, just as a server would; this does not generate the request oracle. Task responses include the real `scope` envelope. Null receipts and a complete succeeded task receipt are tested; successful decoding must leave the clients ready.
- Supplemental assertions cover safe generic errors, live-read cancellation propagation, collaboration unknown outcome, and a succeeded Git task receipt with the exact no-repeat warning. Clock output for connection health uses a fixed test clock, not an expected value copied from actual output.

## Request mock and limitations

The installed web facade, repository/collaboration adapters, `openRemoteAgent`, and source AgentClient serializers/input validators/response decoders execute unchanged. The harness mocks `AgentClient.request` on local and newly created remote clients. Local initialization identity is a fixture. Real `openRemoteAgent` initialization goes through a tightly checked in-memory `hosts.send`/`hosts.receive` bootstrap (fixed route, request-ID format, protocol/client envelope, response identity). Later remote methods are still mocked at **request**, not at the facade or adapter. Host close cleanup is checked too. Requests, including unexpected calls hidden by application recovery, must match the strict per-host queue.

These tests establish client dispatch/resource/alias behavior at that boundary, **not** real SSH, authentication, protocol transport delivery, installed Agent/server correctness, Git/provider side effects, persistence, or UI acceptance. `connectionApi.test` covers a cached verified host; it does not automate interactive fingerprint consent. File cases cover registered-repository routing, not every directory-grant fallback branch. Collaboration and Git writes that expose passthrough values have explicit return assertions, not claims of server-side domain-schema validation. This is scoped contract evidence, not complete branch/feature/platform acceptance.

## Certification and provenance

The runner requires exactly all 124 live frozen bindings, then independently records `node:test` events. It requires one successful non-skipped/non-todo test per exact file/name, a successful whole-batch summary, no failed/cancelled/skipped/todo tests, and no duplicate/missing/unexpected passes. Any red batch produces diagnostics but **no passed receipts**. Existing output directories are rejected, preventing reuse of stale successful receipts after an interruption.

Thirteen tool regressions cover certification success/failure/cancellation/skip/todo/duplicates, complete frozen input bytes, malformed/retired/incomplete/foreign-host bindings, wrong SHA, source/proof tampering, scratch output boundaries, and operation UUID format/correlation/payload drift. Business source bytes are compared with pinned HEAD; candidate first-party TS/TSX sources and replay tools are hashed before and after execution. Loaded modules are separately traced and rehashed. Node and TypeScript compiler JS files are hashed explicitly.

`proof.json` embeds source state, loaded-input hashes, expected tests, counts, and event-file digest. `source-state.json`, `loaded-inputs.jsonl`, and `test-events.json` retain raw evidence. `receipts.json` uses the existing `{path, sha256}` local-proof format. New uncommitted tools are content-addressed working-tree additions, **not** falsely claimed as committed HEAD files. This is auditable local evidence, not a signed attestation against malicious tool edits.

## Accurate progress

- **124/125 scoped IDs** now have passing assertions; only `client-api:apps/web/src/api/index.ts:gitTimeout.timeout` remains intentionally uncovered.
- Compared with the initial 63-case implementation, this continuation adds **61** live-ID associations.
- Original missing count: 2112; prior frozen remaining worklist: 1669; this client's total scoped addition reduces that worklist arithmetically to **1545**, without merging historical SHA receipts into current release evidence.
- `client-progress.json` preserves all 125 original rows and the explicit uncovered retired ID. The release checker counts only these 124 current receipts against all 2758 ledger entries.
- The earlier 63-case intermediate replay is preserved in session scratch, not mixed into the final input. The durable 124-case evidence is archived under `docs/acceptance/issue-257-258/followup-8f30e6b/inputs/client/`.
- This client implementation changes no business source. Overall follow-up integration also updates the acceptance command and documentation. No commit is performed.
