# PixRemove public API v1 — the contract this SDK calls

The SDK talks to `https://pixremove.com/api/v1`. This file is what the server
has to provide. Runs started through it share pricing, credits, history and concurrency
limits with the website, browser extension and desktop app.

## Auth

`x-api-key: <key>` on every request. Keys are created at
`/settings/api-keys`. An unknown or revoked key
is `401 unauthenticated`; an account with an unverified email is
`403 email_not_verified`.

## Errors

Every non-2xx answer is JSON:

```json
{ "error": { "code": "insufficient_credits", "message": "…", "details": { "required": 2, "balance": 0 } } }
```

| Status | code | SDK behaviour |
|---|---|---|
| 400 / 413 / 415 | `input` | throw |
| 401 | `unauthenticated` | throw; CLI stops the batch |
| 402 | `insufficient_credits` | throw; CLI stops the batch |
| 403 | `email_not_verified` | throw; CLI stops the batch |
| 404 | `not_found` | throw |
| 429 | `rate_limit` (+ `retry-after` seconds) | retry, nothing was started |
| 5xx | `provider` / `internal` / … | retry GETs, uploads, and starts that carry an idempotency key |

## Endpoints

### `GET /api/v1/me`

```json
{
  "signedIn": true,
  "credits": 120,
  "free": null,
  "limits": { "removalCost": 2, "concurrency": 4, "maxBatch": 50 },
  "user": { "id": "…", "name": "…", "email": "…", "image": null }
}
```

### `POST /api/v1/upload`

Raw PNG or JPEG body, `content-type: image/png | image/jpeg`, under 30 MB.
→ `201 { "key": "task-sources/…/source.png" }`

### `POST /api/v1/remove-background`

```json
{
  "sourceKey": "task-sources/…/source.png",
  "filename": "cat.png",
  "mimeType": "image/png",
  "sizeBytes": 123456,
  "width": 1200,
  "height": 800,
  "tier": "standard",
  "prompt": "only the bag",
  "idempotencyKey": "sdk_3f2a…"
}
```

`tier`, `prompt` and `idempotencyKey` are optional. A repeated
`idempotencyKey` returns the original run (`200`, `replayed: true`) without
holding credits again.

→ `201 { "taskId": "…", "status": "queued", "creditsHeld": 2, "replayed": false }`

### `GET /api/v1/tasks/:taskId`

```json
{
  "id": "…",
  "status": "succeeded",
  "active": false,
  "creditsCharged": 2,
  "errorCode": null,
  "errorMessage": null,
  "canvas": { "width": 1200, "height": 800 },
  "cutoutPath": "/api/tasks/…/layer/cutout"
}
```

`status` is `queued | running | succeeded | failed | cancelled`. `cutoutPath`
is set once the run succeeded; the SDK fetches it relative to the base URL
with the same `x-api-key` header, and gets a PNG back.
