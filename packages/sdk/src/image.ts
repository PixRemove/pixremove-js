import { PixRemoveError } from './errors.js';

export type ImageMime = 'image/png' | 'image/jpeg';

export type ImageInfo = {
  mimeType: ImageMime;
  width: number;
  height: number;
};

/**
 * Type and pixel size from the file header alone. The API takes PNG and JPEG
 * only and wants the dimensions with the request, so this runs before the
 * upload and turns anything else into an `input` error up front.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo {
  if (isPng(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      mimeType: 'image/png',
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(bytes);
    if (size) return { mimeType: 'image/jpeg', ...size };
  }
  throw new PixRemoveError({
    status: 0,
    code: 'input',
    message:
      'Only PNG and JPEG images are supported. Convert other formats (WebP, HEIC, GIF) first.',
  });
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= 24 && signature.every((b, i) => bytes[i] === b);
}

/** Walk the JPEG markers to the first start-of-frame, which holds the size. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Fill bytes and standalone markers carry no length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}
