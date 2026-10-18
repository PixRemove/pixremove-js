# AGENTS.md

- Public repo `github.com/PixRemove/pixremove-js`: everything here is visible to anyone. No secrets, no internal URLs, no owner notes.
- `packages/sdk` (`@pixremove/sdk`) has zero runtime dependencies and must keep running outside Node (Workers, browsers): `fetch`, `Uint8Array`, `AbortSignal` only, no `node:*` imports in `src/`.
- `packages/cli` (`@pixremove/cli`, command `pixremove`; npm refused the bare name `pixremove` as too close to `premove`) is the only place that touches the file system.
- The server contract is the "HTTP API" section of `README.md`. Change it together with the server's `/api/v1` routes, never one side alone.
- Starting a run can cost credits: a retry of `POST /remove-background` is only allowed with an idempotency key.
- Before committing: `pnpm build && pnpm typecheck && pnpm test`.
- Publishing is the Release workflow on a `v*` tag; both package versions must equal the tag. Do not `npm publish` by hand except the first release.
- Commit format: `type(scope): summary` with `feat` / `fix` / `chore`; scopes `sdk`, `cli`, `ci`, `docs`.
