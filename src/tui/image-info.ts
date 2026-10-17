/** What the transcript knows about an image: enough to describe it, and (when small) to open or copy it. */
export interface ImageRef {
  mediaType: string;
  bytes: number;
  width?: number;
  height?: number;
  /** Base64 payload, kept only for images up to {@link IMAGE_DATA_LIMIT} so the UI can open or copy them. */
  data?: string;
}

export const IMAGE_DATA_LIMIT = 8 * 1024 * 1024;
const HEADER_BYTES = 256 * 1024;
const PNG_SIGNATURE = '89504e470d0a1a0a';
const JPEG_NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc]);

interface Size { width: number; height: number }

function pngSize(data: Buffer): Size | undefined {
  if (data.length < 24 || data.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return undefined;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function gifSize(data: Buffer): Size | undefined {
  if (data.length < 10 || data.subarray(0, 4).toString('latin1') !== 'GIF8') return undefined;
  return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}

function jpegSize(data: Buffer): Size | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.has(marker);
    if (isFrame) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return undefined;
}

function webpSize(data: Buffer): Size | undefined {
  if (data.length < 30 || data.subarray(0, 4).toString('latin1') !== 'RIFF' || data.subarray(8, 12).toString('latin1') !== 'WEBP') return undefined;
  const format = data.subarray(12, 16).toString('latin1');
  if (format === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (format === 'VP8L') {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  return undefined;
}

/** Pixel size read from the file header of a PNG, JPEG, GIF or WebP image; undefined for anything else. */
export function imageDimensions(data: Buffer): Size | undefined {
  return pngSize(data) ?? gifSize(data) ?? jpegSize(data) ?? webpSize(data);
}

function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Describes an Anthropic `image` content block (base64 source); undefined for other blocks. */
export function describeImageBlock(block: unknown): ImageRef | undefined {
  if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) return undefined;
  const { media_type: mediaType, data } = block.source;
  if (typeof mediaType !== 'string' || typeof data !== 'string') return undefined;
  const bytes = decodedBytes(data);
  const size = imageDimensions(Buffer.from(data.slice(0, Math.ceil(HEADER_BYTES * 4 / 3)), 'base64'));
  return { mediaType, bytes, ...size, ...(bytes <= IMAGE_DATA_LIMIT ? { data } : {}) };
}

/** Every image block of a message or tool-result content array. */
export function imageBlocks(content: unknown): ImageRef[] {
  return (Array.isArray(content) ? content : []).flatMap(block => describeImageBlock(block) ?? []);
}
