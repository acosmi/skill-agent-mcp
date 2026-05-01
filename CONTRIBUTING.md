# Contributing

## Dev setup

```bash
bun install
bun test
bunx tsc --noEmit
```

The repository targets Bun ≥ 1.3.0 and TypeScript ≥ 5.4. Node ≥ 20 is
the runtime baseline used by the CLI shim, but everything ships as TS
sources — there's no JS build step in the dev loop today (`bun` runs
TypeScript natively).

## Code style

- Strict TS only. `verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
  and `noImplicitOverride` are on by default; respect them.
- Imports use the `.ts` extension explicitly (matches v1.0 + the bundler
  resolution mode in `tsconfig.json`).
- No emoji in source files unless the user explicitly asks for them.
- One blank line between top-level definitions; no double-blanks.

## Commit style

Commits should be **why-driven**, not **what-driven**. The `tsc` /
`git diff` output already tells reviewers what changed; the commit
message should explain why the change is the right move.

Format:

```
<type>(<scope>): <one-sentence rationale>

<Optional 1-N paragraphs covering: trade-offs considered, related
parties affected, deliberate divergences from upstream, known follow-ups.>

Co-Authored-By: <if applicable>
```

`<type>` follows Conventional Commits (`feat`, `fix`, `chore`, `test`,
`docs`, `refactor`, `perf`).

## Subsystem boundaries

Stick to the existing module layout — adding a fresh top-level module
under `src/` requires an entry in [`README.md`'s subsystem table +
`ARCHITECTURE.md`'s diagram](./ARCHITECTURE.md). Cross-module imports
should use the public re-exports from each module's `index.ts`, not
deep imports into sibling files.

## Tests

`bun test` runs everything under `tests/`. Module tests live under
`tests/<module>/<name>.test.ts`. Tests should:

- Cover the public surface from the perspective of a consumer.
- Avoid touching disk except via `os.tmpdir()` + `mkdtemp` when
  filesystem behaviour is the point.
- Skip (`describe.skip`) instead of delete when a test isn't relevant
  to this package, with an inline comment explaining why.

## Translation provenance

Files copied verbatim from `@acosmi/agent` v1.0 keep their origin
header comments intact. Files translated from crabclaw Go keep a
provenance comment block at the top covering: source file path, line
ranges, deliberate divergences. This is the audit trail for the
"translation, not fork" promise — please preserve it on every change.

## Releases

Local-only at v1.0; npm publish is gated by removing `private: true`
from `package.json` + registering an npm token. See `CHANGELOG.md`'s
Status section for the current state.
