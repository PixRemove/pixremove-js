import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
export const OUTPUT_SUFFIX = '-nobg';

/**
 * Files and folders from the command line → the images to process. Folders
 * are read one level deep, and earlier outputs (`*-nobg.png`) are skipped so
 * running the same command twice does not cut out the cut-outs.
 */
export async function collectImages(inputs: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const input of inputs) {
    const info = await stat(input);
    if (info.isDirectory()) {
      const entries = await readdir(input);
      for (const entry of entries.sort()) {
        if (isImage(entry)) found.push(path.join(input, entry));
      }
    } else {
      found.push(input);
    }
  }
  return [...new Set(found)];
}

function isImage(name: string): boolean {
  const { ext, name: base } = path.parse(name);
  return IMAGE_EXTENSIONS.has(ext.toLowerCase()) && !base.endsWith(OUTPUT_SUFFIX);
}

/** `photos/cat.jpg` → `photos/cat-nobg.png`, or into `outDir` when given. */
export function outputPath(input: string, outDir?: string): string {
  const { dir, name } = path.parse(input);
  return path.join(outDir ?? dir, `${name}${OUTPUT_SUFFIX}.png`);
}
