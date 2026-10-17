#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PixRemove, PixRemoveError } from '@pixremove/sdk';
import { collectImages, outputPath } from './files.js';

const VERSION = '0.1.0';

const HELP = `Remove image backgrounds with PixRemove.

Usage
  pixremove <file|folder>...   Cut out each PNG/JPEG into <name>-nobg.png
  pixremove account            Show credit balance and limits

Options
  -o, --out <dir>         Write results here instead of next to each input
  -p, --prompt <text>     What to keep, e.g. "only the bag" (guided run)
  -c, --concurrency <n>   Runs at once (default: your account's limit)
      --overwrite         Replace existing -nobg.png files
      --api-key <key>     Defaults to $PIXREMOVE_API_KEY
  -h, --help
  -v, --version

Get an API key at https://pixremove.com/settings/api-keys`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      prompt: { type: 'string', short: 'p' },
      concurrency: { type: 'string', short: 'c' },
      overwrite: { type: 'boolean' },
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const apiKey = values['api-key'] ?? process.env.PIXREMOVE_API_KEY;
  if (!apiKey) {
    console.error('No API key. Set PIXREMOVE_API_KEY or pass --api-key.');
    console.error('Create one at https://pixremove.com/settings/api-keys');
    return 1;
  }
  const client = new PixRemove({
    apiKey,
    baseUrl: values['base-url'] ?? process.env.PIXREMOVE_BASE_URL,
  });

  if (positionals[0] === 'account' && positionals.length === 1) {
    const account = await client.getAccount();
    console.log(`Account:      ${account.user?.email ?? '-'}`);
    console.log(`Credits:      ${account.credits ?? 0}`);
    if (account.limits) {
      console.log(`Per removal:  ${account.limits.removalCost} credit(s)`);
      console.log(`Concurrency:  ${account.limits.concurrency}`);
    }
    return 0;
  }

  const files = await collectImages(positionals);
  if (files.length === 0) {
    console.error('No PNG or JPEG images found.');
    return 1;
  }
  if (values.out) await mkdir(values.out, { recursive: true });

  const concurrency = values.concurrency
    ? Math.max(1, Number.parseInt(values.concurrency, 10) || 1)
    : ((await client.getAccount().catch(() => null))?.limits?.concurrency ?? 2);

  let failed = 0;
  let credits = 0;
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const target = outputPath(file, values.out);
      if (!values.overwrite && (await exists(target))) {
        console.log(`skip  ${file} (${path.basename(target)} exists)`);
        continue;
      }
      try {
        const result = await client.removeBackground(await readFile(file), {
          prompt: values.prompt,
          filename: path.basename(file),
        });
        await writeFile(target, result.data);
        credits += result.creditsCharged;
        console.log(`done  ${file} → ${target}`);
      } catch (error) {
        failed++;
        console.error(`fail  ${file}: ${describe(error)}`);
        // Out of credits or a bad key will fail every remaining file too.
        if (error instanceof PixRemoveError && STOP_CODES.has(error.code)) queue.length = 0;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  console.log(`\n${files.length - failed}/${files.length} done, ${credits} credits used.`);
  return failed ? 1 : 0;
}

const STOP_CODES = new Set(['unauthenticated', 'email_not_verified', 'insufficient_credits']);

function describe(error: unknown): string {
  if (error instanceof PixRemoveError) return `${error.message} [${error.code}]`;
  return error instanceof Error ? error.message : String(error);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(describe(error));
    process.exit(1);
  }
);
