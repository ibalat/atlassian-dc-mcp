import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatAttachmentToolResponse } from '../attachment-tool-response.js';
import type { AttachmentDownloadResult } from '../attachment-download.js';
import { formatToolResponse } from '../tool-response.js';

const jsonBlock = (result: unknown) => formatToolResponse(result).content[0];

/** Real magic numbers, so the byte sniffer sees what a genuine file would carry. */
const HEADERS: Record<string, number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  bmp: [0x42, 0x4d, 0x36, 0x00],
  svg: [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')],
  html: [...Buffer.from('<!DOCTYPE html><html><head><title>Log in')],
};

/** Base64 of a plausible file: the format's magic number plus padding bytes. */
const bytesOf = (format: keyof typeof HEADERS, size = 64) =>
  Buffer.concat([Buffer.from(HEADERS[format]), Buffer.alloc(Math.max(0, size - HEADERS[format].length))]).toString('base64');

const attachment = (over: Partial<AttachmentDownloadResult> = {}): AttachmentDownloadResult => ({
  filename: 'shot.png',
  mediaType: 'image/png',
  size: 64,
  content: bytesOf('png'),
  encoding: 'base64',
  ...over,
});

const wrap = (...attachments: AttachmentDownloadResult[]) => ({
  success: true,
  data: { count: attachments.length, attachments },
});

const format = (result: Parameters<typeof formatAttachmentToolResponse>[0], mode: 'image' | 'base64' | 'text' = 'image') =>
  formatAttachmentToolResponse(result, mode);

describe('formatAttachmentToolResponse', () => {
  it('emits a labelled image block and drops the bytes from the JSON', () => {
    const png = bytesOf('png');
    const content = format(wrap(attachment({ content: png }))).content;

    expect(content).toHaveLength(3);
    expect(content[0]).toEqual(
      jsonBlock({
        success: true,
        data: {
          count: 1,
          // The base64 payload is gone from the JSON: shipping it here as well as in
          // the image block roughly triples the result and costs ~60x the tokens.
          attachments: [
            { filename: 'shot.png', mediaType: 'image/png', size: 64, encoding: 'base64', contentDeliveredAs: 'image' },
          ],
        },
      }),
    );
    expect(content[1]).toEqual({ type: 'text', text: 'attachments[0] shot.png (image/png, 64 bytes)' });
    expect(content[2]).toEqual({ type: 'image', data: png, mimeType: 'image/png' });
  });

  it('produces a result the SDK will accept over the wire', () => {
    const parsed = CallToolResultSchema.safeParse(format(wrap(attachment())));
    expect(parsed.success).toBe(true);
  });

  describe('media type is taken from the bytes, not from the declaration', () => {
    it.each([
      ['png', 'image/png'],
      ['jpeg', 'image/jpeg'],
      ['gif', 'image/gif'],
      ['webp', 'image/webp'],
    ] as const)('renders a %s as %s', (format_, expected) => {
      const content = format(wrap(attachment({ content: bytesOf(format_), mediaType: 'application/octet-stream' }))).content;
      expect(content[2]).toEqual({ type: 'image', data: bytesOf(format_), mimeType: expected });
    });

    it('corrects a JPEG that was uploaded as .png, in the block and the entry', () => {
      const content = format(wrap(attachment({ filename: 'shot.png', mediaType: 'image/png', content: bytesOf('jpeg') }))).content;

      expect(content[2]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
      expect(JSON.parse((content[0] as { text: string }).text).data.attachments[0]).toMatchObject({
        mediaType: 'image/jpeg',
      });
    });

    it.each([
      ['svg', 'image/svg+xml'],
      ['bmp', 'image/bmp'],
      ['html', 'image/png'],
    ] as const)('skips %s bytes even when declared as %s', (format_, declared) => {
      const result = wrap(attachment({ mediaType: declared, content: bytesOf(format_) }));
      const content = format(result).content;

      expect(content).toHaveLength(1);
      expect(JSON.parse((content[0] as { text: string }).text).data.attachments[0]).toMatchObject({
        contentOmittedReason: expect.stringContaining('Not a PNG, JPEG, GIF or WEBP image'),
      });
    });
  });

  it('keeps image blocks out unless returnContent is image', () => {
    const result = wrap(attachment());
    expect(format(result, 'base64')).toEqual({ content: [jsonBlock(result)] });
    expect(format(result, 'text')).toEqual({ content: [jsonBlock(result)] });
    expect(formatAttachmentToolResponse(result)).toEqual({ content: [jsonBlock(result)] });
  });

  it('labels each image with its index so repeated filenames stay distinguishable', () => {
    const content = format(
      wrap(
        attachment({ filename: 'shot.png', size: 9_000_000, content: undefined, encoding: undefined, contentOmittedReason: 'over cap' }),
        attachment({ filename: 'dup.png', content: bytesOf('png') }),
        attachment({ filename: 'dup.png', content: bytesOf('jpeg') }),
      ),
    ).content;

    expect(content.filter((block) => block.type === 'image')).toHaveLength(2);
    expect(content.filter((block) => block.type === 'text').map((block) => (block as { text: string }).text).slice(1)).toEqual([
      'attachments[1] dup.png (image/png, 64 bytes)',
      'attachments[2] dup.png (image/jpeg, 64 bytes)',
    ]);
  });

  it('caps the number of image blocks in one result', () => {
    const many = Array.from({ length: 25 }, (_, i) => attachment({ filename: `s${i}.png` }));
    const content = format(wrap(...many)).content;

    expect(content.filter((block) => block.type === 'image')).toHaveLength(20);
    const entries = JSON.parse((content[0] as { text: string }).text).data.attachments;
    expect(entries[19]).toMatchObject({ contentDeliveredAs: 'image' });
    expect(entries[20]).toMatchObject({ contentOmittedReason: expect.stringContaining('Only the first 20 images') });
    // Nothing beyond the cap carries bytes either, so the result stays bounded.
    expect(entries.slice(20).every((e: { content?: string }) => e.content === undefined)).toBe(true);
  });

  it('skips an oversized payload rather than letting the API reject it', () => {
    const huge = attachment({ size: 4_000_000, content: bytesOf('png', 4_000_000) });
    const content = format(wrap(huge)).content;

    expect(content).toHaveLength(1);
    expect(JSON.parse((content[0] as { text: string }).text).data.attachments[0]).toMatchObject({
      contentOmittedReason: expect.stringContaining('exceeds the 5000000 byte per-image limit'),
    });
  });

  it('never emits an empty image block', () => {
    const result = wrap(attachment({ content: '', size: 0 }));
    expect(format(result)).toEqual({ content: [jsonBlock(result)] });
  });

  it('leaves text-encoded attachments and omitted content untouched', () => {
    const result = wrap(
      attachment({ filename: 'a.png', content: bytesOf('png'), encoding: 'text' }),
      attachment({ filename: 'huge.png', content: undefined, encoding: undefined, size: 9_000_000, contentOmittedReason: 'over cap' }),
    );
    expect(format(result)).toEqual({ content: [jsonBlock(result)] });
  });

  it('passes through failures and unexpected shapes', () => {
    const failure = { success: false, error: 'Error downloading attachment: 404 ' };
    expect(format(failure)).toEqual({ content: [jsonBlock(failure)] });
    expect(format({ success: true, data: {} })).toEqual({ content: [jsonBlock({ success: true, data: {} })] });

    // An error result must not render an image even if one is somehow attached.
    const errorWithImage = { success: false, error: 'boom', data: { attachments: [attachment()] } };
    expect(format(errorWithImage)).toEqual({ content: [jsonBlock(errorWithImage)] });
  });
});
