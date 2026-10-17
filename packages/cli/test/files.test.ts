import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectImages, outputPath } from '../src/files.js';

describe('collectImages', () => {
  it('reads folders, keeps PNG/JPEG and skips earlier outputs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pixremove-'));
    for (const name of ['a.jpg', 'b.PNG', 'b-nobg.png', 'notes.txt', 'c.webp']) {
      await writeFile(path.join(dir, name), '');
    }
    const files = await collectImages([dir, path.join(dir, 'a.jpg')]);
    expect(files.map((f) => path.basename(f))).toEqual(['a.jpg', 'b.PNG']);
  });
});

describe('outputPath', () => {
  it('writes next to the input or into --out', () => {
    expect(outputPath('photos/cat.jpg')).toBe(path.join('photos', 'cat-nobg.png'));
    expect(outputPath('photos/cat.jpg', 'out')).toBe(path.join('out', 'cat-nobg.png'));
  });
});
