# @pixremove/sdk

Official JavaScript / TypeScript SDK for the [PixRemove](https://pixremove.com) background removal API. Pass in a PNG or JPEG, get back a transparent PNG cut-out.

- Typed, zero dependencies, ESM
- Node 20.19+, Bun, Deno, Cloudflare Workers (server side: keep your API key out of browser code)
- Waits for the result for you, retries rate limits safely, never charges twice for a retry

> **Preview.** API keys open with the PixRemove developer launch. Until then requests answer `401`.

## Install

```bash
npm install @pixremove/sdk
```

## Quick start

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { PixRemove } from '@pixremove/sdk';

const pixremove = new PixRemove({ apiKey: process.env.PIXREMOVE_API_KEY! });

const result = await pixremove.removeBackground(await readFile('product.jpg'));
await writeFile('product-nobg.png', result.data);

console.log(result.width, result.height, `${result.creditsCharged} credits`);
```

Create an API key at [pixremove.com/settings/api-keys](https://pixremove.com/settings/api-keys).

## Options

```ts
await pixremove.removeBackground(image, {
  tier: 'precise',          // 'standard' (default) or 'precise' — finer hair, fur and glass edges
  prompt: 'only the bag',   // keep just what you describe (guided run)
  filename: 'bag.jpg',      // name shown in your history on pixremove.com
  idempotencyKey: 'order-42-photo-1', // your own retry key
  timeoutMs: 120_000,
  signal: abortController.signal,
});
```

`image` is a `Uint8Array` (Node `Buffer` works), `ArrayBuffer` or `Blob` / `File`. PNG and JPEG only, up to 30 MB.

## Errors

Everything throws `PixRemoveError` with an HTTP `status` and a machine-readable `code`:

```ts
import { PixRemoveError } from '@pixremove/sdk';

try {
  await pixremove.removeBackground(image);
} catch (error) {
  if (error instanceof PixRemoveError && error.code === 'insufficient_credits') {
    // error.details → { required, balance }
  }
}
```

| code | meaning |
|---|---|
| `unauthenticated` | missing, wrong or revoked API key |
| `insufficient_credits` | top up at pixremove.com/pricing |
| `input` | not a PNG/JPEG, too large, or a bad option |
| `task_failed` | the run itself failed; `details.errorCode` says why (e.g. `moderation`) and no credits were charged |
| `timeout` | gave up after `timeoutMs` |
| `rate_limit` | still limited after the SDK's retries |

## Lower-level calls

`removeBackground` is these steps in order, each also callable on its own:

```ts
const account = await pixremove.getAccount();          // credits and limits
const key = await pixremove.upload(bytes, 'image/png');
const { taskId } = await pixremove.createTask({ sourceKey: key, /* … */ });
const task = await pixremove.waitForTask(taskId);
const png = await pixremove.downloadCutout(task);
```

## Coming from remove.bg?

| remove.bg | PixRemove |
|---|---|
| `X-Api-Key` header | `apiKey` option (sent as `x-api-key`) |
| `image_file` | `removeBackground(bytes)` |
| `size` | `tier: 'standard'` or `'precise'` |
| `type=product / person / car` | not needed — detected automatically; use `prompt` to choose |
| `GET /account` | `getAccount()` |

Background colour, crop and shadow options are not in the API yet; apply them to the transparent PNG yourself for now.

## Command line

Need batch processing without writing code? See [`pixremove`](https://www.npmjs.com/package/pixremove):

```bash
npx pixremove ./photos -o ./cutouts
```

## License

MIT
