# PixRemove for JavaScript

Official JavaScript tools for the [PixRemove](https://pixremove.com) background removal API.

| Package | |
|---|---|
| [`@pixremove/sdk`](packages/sdk) | TypeScript SDK — `removeBackground(image)` → transparent PNG |
| [`pixremove`](packages/cli) | CLI — `npx pixremove ./photos` batch cut-outs |

```ts
import { PixRemove } from '@pixremove/sdk';

const pixremove = new PixRemove({ apiKey: process.env.PIXREMOVE_API_KEY! });
const { data } = await pixremove.removeBackground(imageBytes);
```

The HTTP API both packages call is described in [docs/api-v1.md](docs/api-v1.md).

## Development

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test
```

Releases: bump `version` in both `packages/*/package.json`, commit, then push a `vX.Y.Z` tag. The Release workflow publishes both packages to npm with provenance.

## License

MIT
