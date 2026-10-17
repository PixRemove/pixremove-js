# pixremove

Remove image backgrounds from the command line with [PixRemove](https://pixremove.com). Point it at files or whole folders and get transparent PNGs back.

> **Preview.** API keys open with the PixRemove developer launch.

```bash
export PIXREMOVE_API_KEY=your_key   # https://pixremove.com/settings/api-keys

npx pixremove product.jpg                 # → product-nobg.png
npx pixremove ./photos -o ./cutouts       # every PNG/JPEG in the folder
npx pixremove bag.jpg --prompt "only the bag"
npx pixremove account                     # credits left
```

Or install it once: `npm install -g pixremove`.

## Options

| | |
|---|---|
| `-o, --out <dir>` | write results here instead of next to each input |
| `-p, --prompt <text>` | keep only what you describe |
| `-c, --concurrency <n>` | runs at once (default: your account's limit) |
| `--overwrite` | replace existing `-nobg.png` files (skipped by default, so re-running only does what is left) |
| `--api-key <key>` | instead of `$PIXREMOVE_API_KEY` |

The batch stops early when the key is wrong or credits run out, and exits non-zero if any file failed.

For use from code, see [`@pixremove/sdk`](https://www.npmjs.com/package/@pixremove/sdk).

## License

MIT
