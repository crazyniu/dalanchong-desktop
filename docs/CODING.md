# Code and AI Annotation Contract

Audience: AI agents maintaining this desktop application. Optimize annotations for reconstructing behavior, locating ownership, and preserving invariants. Human-facing brevity is not a reason to omit reasoning context an AI needs. This contract does not authorize tests, builds, publication, or unrelated refactoring.

## Language and coverage

- All source comments and module/function documentation must be English.
- Preserve Chinese product labels, errors, fixture strings, and release notes: these are program data or user-facing content, not comments.
- Every maintained source file needs an English `AI module map` or `AI file map` inside the file. Include local Shadcn wrappers, declarations, styles, injected scripts, existing tests, examples, operational scripts, and workflows.
- Do not annotate installed dependencies, generated code, lockfile entries, vendored implementations, or binary assets. Local component wrappers are maintained source even when originally copied from a template.
- Keep shell shebangs and HTML doctypes first. Preserve Rust attributes, JavaScript directive prologues, TypeScript reference directives, and machine-readable comment directives.
- Strict JSON cannot contain comments. Document each such configuration in [AI_CODE_MAP.md](AI_CODE_MAP.md); do not invent metadata keys. TypeScript/VS Code JSONC files may contain an in-file comment header.
- Narrative Markdown and release notes do not need code-comment wrappers. AI-specific technical guides use English; preserve the intended language of product documentation. All Markdown describes retained functionality only; remove documentation for deleted features, including historical release entries and migration descriptions.

## Required file map

Use native comment syntax: Rust `//!`, JS/TS/CSS `/** ... */`, shell/YAML/TOML/ignore-file `#`, and HTML `<!-- ... -->`. Describe the implementation actually present, not a generic filename summary.

Record the following facts where applicable:

1. **Purpose:** concrete responsibility and architectural layer.
2. **Entry:** actual exports, commands, events, routes, build entry, and callers.
3. **Flow:** inputs, transformations, outputs, transports, persistence paths, and related files.
4. **State/ownership:** authoritative versus derived state, account/platform/session scope, lifetime, locks, cleanup, and resource ownership.
5. **Invariants/boundaries:** ordering, permissions, identity rules, failure semantics, and behavior future changes must preserve.
6. **Side effects:** network, file writes, native views, timers, publication, or presentation-only responsibility.

Small wrappers can explain their full contract in a few precise lines. Orchestration modules require fuller maps and local explanations. There is no fixed comment-length quota: include enough detail for an AI to reason without opening every dependency first.

```ts
/**
 * AI module map
 * Purpose: identify the concrete responsibility owned here.
 * Entry: name actual callers and exports.
 * Flow: connect inputs, authoritative state, outputs, and related modules.
 * Invariants: state constraints a future edit must preserve.
 */
```

This is a structural example, not text to paste unchanged into source files.

## Local reasoning annotations

- Explain non-obvious decisions, schemas, ID scope, transitions, concurrency, and failure recovery next to the relevant code. Do not merely restate function names or syntax.
- Significant exported functions and IPC boundaries need caller requirements, side effects, result meaning, and cleanup/failure details when the file map alone is insufficient.
- Explain transitions such as `sending -> success/review`, task registration/release, document-sequence invalidation, and update installation exclusion. Distinguish “not sent” from “outcome unknown.”
- Every `unsafe` block needs a nearby `SAFETY:` explanation covering valid pointers, buffer sizes, ownership transfer, and release conditions. Explain binary offsets, byte order, and terminators.
- For injected/serialized JavaScript, explain the execution realm, unavailable module dependencies, placeholder substitution, source allowlists, and native IPC relationship.
- For UI wrappers, document controlled state, event ownership, and inherited primitive semantics. Do not imply they own network or domain state when they only render props.
- Tests and operational scripts must describe fixtures and real side effects. Their comments are never instructions to execute them during normal editing.
- Keep machine directives and required license notices intact. Remove stale/contradictory explanations and update comments with behavior. Do not invent guarantees, claim tests passed, record chat history, or leave required work as a TODO.

## Formatting and implementation

- JS/TS/TSX use existing `.prettierrc` settings: two spaces, single quotes, no semicolons, LF, configured import/Tailwind ordering. Rust uses default rustfmt style and four spaces. Do not run bulk formatters merely to maintain comments.
- Use domain-specific names. React components/types use PascalCase; JS functions/variables use camelCase; Rust modules/functions use snake_case and constants use SCREAMING_SNAKE_CASE. Preserve protocol field names.
- Retain TypeScript strictness and type-only imports. Define boundary shapes instead of bypassing errors with `any` or layered casts. Do not rewrite JavaScript merely to enforce a different language choice.
- Keep module responsibilities direct. Extract logic for current needs, not speculative frameworks, compatibility branches, or one-use service layers.
- No defensive overengineering: propagate actual failures rather than fabricating success or adding speculative retries. Necessary authorization, input, pointer, and buffer-boundary checks remain mandatory.
- Synchronous mutexes must not cross `await`; retain existing async locks/queues and explain their scope. Preserve snapshot-before-send, cleanup, and install ordering.
- Annotation-only changes preserve behavior, payloads, UI strings, and unrelated work.

## Persistent security and product constraints

- Hardware fingerprint domain, platform tag, byte order, the intermediate `hw-v1-<SHA-256>` string, and its final MD5-to-32-hex rule are persistent binding protocol. They cannot vary with app version or data directory. This is identifier derivation, not a signature or hardware attestation.
- Rust owns online licensing; the server decides validity/expiry. Business operations read the latest native in-memory result; persisted validity and frontend state are not credentials. Only the activation code is loaded from the license cache; raw hardware UUIDs stay inside the device module.
- The native monitor verifies once at startup and every 10 minutes afterward when an activation code is saved, including after an invalid response. Ordinary business entries, state reads, dialog opening and platform requests only read the latest native result; they must not call the verification service or wait for its network mutex. The activation form may prefill the saved code through main-only license_saved_code/getSavedLicenseCode; the native command uses spawn_blocking to read code directly from the fixed license-tauri.json, without acquiring the background network service lock or adding a state cache. Only an explicit user click on 重新验证 invokes main-only license_verify, which verifies the native saved code and publishes the result without activation. When normalized form input matches the saved code and state.reason is not device_unbound, use that verification action; device_unbound or an edited new code uses explicit activation, preserving the old saved code until the new activation succeeds. Keep the saved code out of license_state, authorization broadcasts, logs and diagnostics; form prefill is its only frontend presentation path. Neither command accepts a frontend device identity or bypasses native/server licensing. Do not persist validity, add development backdoors, or activate automatically after failed verification.
- Privileged commands require the real Tauri caller. Remote pages and auxiliary views retain limited capabilities. Cancellation and result saving remain available after expiry; document these exceptions.
- The existing server transaction allows one device per code. Admin unbind is required for migration/replacement without extending expiry. Do not claim hardware attestation or absolute resistance to spoofing/patching.
- Release WebViews disable developer tools. Client updates use a public verification key; private signing/service credentials never enter source or diagnostics.
- Keep app-local caches, not keychain access. Never log activation codes, cookies, tokens, raw hardware IDs, or credential-bearing request bodies.
- Keep explicit-close dialogs, centered loading, necessary concise UI text, and runtime-owned background tasks. English AI annotations must not appear as product copy.

## Delivery boundaries

- Testing and acceptance belong to the user. Without an explicit request, do not write/run tests, lint, builds, UI automation, screenshots, or temporary verification programs.
- A requested build/package/release permits only required steps, without expanding test scope.
- Source reading, text searches, and comment editing are allowed for documentation work. Do not report source inspection as a passed test.
- Ordinary edits do not authorize commit, push, publication, installation, or changes to live account data.
