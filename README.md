# PixRemove for JavaScript

Remove image backgrounds from your own code, scripts and pipelines with [PixRemove](https://pixremove.com). Send a PNG or JPEG, get back a transparent PNG at the source's full resolution.

| Package | |
|---|---|
| [`@pixremove/sdk`](packages/sdk) | TypeScript SDK: `removeBackground(image)` returns a transparent PNG |
| [`@pixremove/cli`](packages/cli) | Command line: `npx @pixremove/cli ./photos` cuts out a whole folder |

Prefer plain HTTP, or another language? The [HTTP API](#http-api) section below is everything the SDK uses.

- [Get an API key](#get-an-api-key)
- [SDK](#sdk)
- [Command line](#command-line)
- [HTTP API](#http-api)
- [Credits and limits](#credits-and-limits)
- [Coming from remove.bg](#coming-from-removebg)

## Get an API key

1. Sign in at [pixremove.com](https://pixremove.com) (verify your email).
2. Open [Settings → API keys](https://pixremove.com/settings/api-keys) and create a key. It starts with `pr_` and is shown once.
3. Keep it on the server side, e.g. `PIXREMOVE_API_KEY` in your environment. Never ship it in browser or app code.

API runs use the same credit balance and history as the website, browser extension and desktop app.

## SDK

```bash
npm install @pixremove/sdk
```

Node 20.19+, Bun, Deno and Cloudflare Workers. Zero dependencies.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { PixRemove } from '@pixremove/sdk';

const pixremove = new PixRemove({ apiKey: process.env.PIXREMOVE_API_KEY! });

const result = await pixremove.removeBackground(await readFile('product.jpg'));
await writeFile('product-nobg.png', result.data);
// result: { taskId, data, mimeType: 'image/png', width, height, creditsCharged }
```

`removeBackground` uploads the image, starts the run, waits for it and downloads the cut-out. Rate limits and dropped connections are retried, and a retry never charges twice.

### Options

```ts
await pixremove.removeBackground(image, {
  prompt: 'only the bag',             // keep just what you describe (guided run, more credits)
  filename: 'bag.jpg',                // name shown in your history on pixremove.com
  idempotencyKey: 'order-42-photo-1', // your own retry key: same key = same run, charged once
  timeoutMs: 120_000,                 // give up waiting after this long
  signal: abortController.signal,
});
```

`image` can be a `Uint8Array` (a Node `Buffer` works), an `ArrayBuffer`, or a `Blob` / `File`. PNG and JPEG only, up to 30 MB. Convert WebP, HEIC or GIF first.

### Errors

Everything throws `PixRemoveError` with an HTTP `status` and a machine-readable `code`:

```ts
import { PixRemoveError } from '@pixremove/sdk';

try {
  await pixremove.removeBackground(image);
} catch (error) {
  if (error instanceof PixRemoveError && error.code === 'insufficient_credits') {
    console.log(error.details); // { required, balance }
  }
}
```

| code | meaning |
|---|---|
| `unauthenticated` | missing, wrong or deleted API key |
| `email_not_verified` | verify the account's email on pixremove.com |
| `insufficient_credits` | top up at [pixremove.com/pricing](https://pixremove.com/pricing) |
| `input` | not a PNG/JPEG, over 30 MB, or a bad option |
| `task_failed` | the run itself failed; `details.errorCode` says why (e.g. `moderation`). Failed runs are not charged |
| `rate_limit` | still limited after the SDK's retries |
| `timeout` | gave up after `timeoutMs` |
| `network` | could not reach the API |

### Step by step

`removeBackground` is these calls in order. Each one is public if you want to queue, poll or store things yourself:

```ts
const account = await pixremove.getAccount();            // { credits, limits, user }
const sourceKey = await pixremove.upload(bytes, 'image/png');
const { taskId } = await pixremove.createTask({
  sourceKey, filename: 'cat.png', mimeType: 'image/png',
  sizeBytes: bytes.byteLength, width: 1200, height: 800,
  idempotencyKey: 'cat-1',
});
const task = await pixremove.waitForTask(taskId);         // or poll getTask(taskId)
const png = await pixremove.downloadCutout(task);
```

`readImageInfo(bytes)` gives `{ mimeType, width, height }` from the file header for `createTask`.

## Command line

```bash
npm install -g @pixremove/cli     # or prefix each command with npx @pixremove/cli
export PIXREMOVE_API_KEY=pr_...

pixremove product.jpg                       # writes product-nobg.png
pixremove ./photos -o ./cutouts             # every PNG/JPEG in the folder
pixremove bag.jpg --prompt "only the bag"   # guided run
pixremove account                           # credits left
```

| option | |
|---|---|
| `-o, --out <dir>` | write results here instead of next to each input |
| `-p, --prompt <text>` | keep only what you describe |
| `-c, --concurrency <n>` | runs at once (default: your account's limit) |
| `--overwrite` | replace existing `-nobg.png` files (by default they are skipped, so a re-run only does what is left) |
| `--api-key <key>` | instead of `$PIXREMOVE_API_KEY` |

The batch stops early when the key is wrong or credits run out, and exits non-zero if any file failed.

## HTTP API

Base URL `https://pixremove.com/api/v1`. Every request carries the header `x-api-key: pr_...`.

A run is four calls: upload the image, start the run, poll until it finishes, download the cut-out.

### 1. Upload: `POST /upload`

Body = the raw image bytes, `content-type: image/png` or `image/jpeg`, under 30 MB.

```bash
curl -X POST https://pixremove.com/api/v1/upload \
  -H "x-api-key: $PIXREMOVE_API_KEY" \
  -H "content-type: image/jpeg" \
  --data-binary @product.jpg
```

`201`

```json
{ "key": "task-sources/…/source.jpg" }
```

### 2. Start: `POST /remove-background`

```bash
curl -X POST https://pixremove.com/api/v1/remove-background \
  -H "x-api-key: $PIXREMOVE_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "sourceKey": "task-sources/…/source.jpg",
    "filename": "product.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 229345,
    "width": 1024,
    "height": 1024,
    "idempotencyKey": "product-1"
  }'
```

| field | |
|---|---|
| `sourceKey` | the `key` from the upload |
| `filename` | shown in your history |
| `mimeType`, `sizeBytes`, `width`, `height` | of the uploaded image |
| `prompt` | optional. What to keep ("only the bag"); makes it a guided run |
| `idempotencyKey` | optional, 8–64 chars of `A-Za-z0-9_-`. Sending the same key again returns the original run (`200`, `"replayed": true`) and does not charge again. Use one whenever you might retry |

`201`

```json
{ "taskId": "…", "status": "queued", "creditsHeld": 1, "replayed": false }
```

Credits are held when the run starts, charged when it succeeds, and released if it fails.

### 3. Poll: `GET /tasks/:taskId`

```bash
curl https://pixremove.com/api/v1/tasks/TASK_ID -H "x-api-key: $PIXREMOVE_API_KEY"
```

```json
{
  "id": "…",
  "status": "succeeded",
  "active": false,
  "creditsCharged": 1,
  "errorCode": null,
  "errorMessage": null,
  "canvas": { "width": 1024, "height": 1024 },
  "cutoutPath": "/api/v1/tasks/…/cutout"
}
```

`status` is `queued`, `running`, `succeeded`, `failed` or `cancelled`. Poll while `active` is `true`; every 1–3 seconds is plenty (most runs finish in a few seconds).

### 4. Download: `GET /tasks/:taskId/cutout`

```bash
curl https://pixremove.com/api/v1/tasks/TASK_ID/cutout \
  -H "x-api-key: $PIXREMOVE_API_KEY" -o product-nobg.png
```

The transparent PNG. `404` until the run has succeeded.

### Account: `GET /me`

```json
{
  "signedIn": true,
  "credits": 120,
  "limits": { "removalCost": 1, "concurrency": 16, "maxBatch": 50 },
  "user": { "id": "…", "name": "…", "email": "…", "image": null }
}
```

### Errors

Every non-2xx answer is JSON:

```json
{ "error": { "code": "insufficient_credits", "message": "…", "details": { "required": 1, "balance": 0 } } }
```

| status | code | what to do |
|---|---|---|
| 400 / 413 / 415 | `input` | fix the request; `details.issues` lists bad fields |
| 401 | `unauthenticated` | check the key |
| 402 | `insufficient_credits` | top up |
| 403 | `email_not_verified` / `forbidden` | verify the email / account suspended |
| 404 | `not_found` | wrong task id, or not your task |
| 429 | `rate_limit` | wait `retry-after` seconds and retry; nothing was started |
| 5xx | `provider` / `internal` / … | retry with backoff (starts only with an `idempotencyKey`) |

## Credits and limits

| | |
|---|---|
| Standard removal | 1 credit (`limits.removalCost` from `/me` is always current) |
| Guided removal (`prompt`) | 3 credits |
| Failed runs | free |
| Input | PNG or JPEG, up to 30 MB |
| Output | transparent PNG, same size as the input |
| Runs in flight per account | `limits.concurrency` from `/me`; more answers `429` |
| Requests per key | 300 a minute |

Plans and credit packs: [pixremove.com/pricing](https://pixremove.com/pricing).

## Coming from remove.bg

| remove.bg | PixRemove |
|---|---|
| `X-Api-Key` header | `x-api-key` header |
| `POST /v1.0/removebg` (one call) | upload → start → poll → download, or one `removeBackground()` call in the SDK |
| `image_file` | raw bytes to `/upload` |
| `size` | not needed: output is the input's full resolution |
| `type=product / person / car` | not needed: detected automatically; `prompt` picks what to keep |
| `GET /account` | `GET /me` |

Background colour, crop and shadow options are not in the API yet. Apply them to the transparent PNG yourself for now.

## Development

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test
```

Releases: bump `version` in both `packages/*/package.json`, commit, then push a `vX.Y.Z` tag. The Release workflow publishes both packages to npm with provenance.

## License

MIT
