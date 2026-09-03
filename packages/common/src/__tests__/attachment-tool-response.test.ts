import { formatAttachmentToolResponse } from '../attachment-tool-response.js';

const jsonBlock = (result: unknown) => ({ type: 'text', text: JSON.stringify(result) });

describe('formatAttachmentToolResponse', () => {
  it('adds an image block for a base64 image attachment', () => {
    const result = {
      success: true,
      data: {
        count: 1,
        attachments: [
          { filename: 'shot.png', mediaType: 'image/png', size: 3, content: 'AAAA', encoding: 'base64' as const },
        ],
      },
    };

    expect(formatAttachmentToolResponse(result)).toEqual({
      content: [jsonBlock(result), { type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    });
  });

  it('normalizes a parameterized media type', () => {
    const result = {
      success: true,
      data: {
        count: 1,
        attachments: [
          { filename: 'shot.png', mediaType: 'Image/PNG; charset=binary', size: 3, content: 'AAAA', encoding: 'base64' as const },
        ],
      },
    };

    expect(formatAttachmentToolResponse(result).content[1]).toEqual({
      type: 'image',
      data: 'AAAA',
      mimeType: 'image/png',
    });
  });

  it('adds one image block per image and keeps non-images out', () => {
    const result = {
      success: true,
      data: {
        count: 3,
        attachments: [
          { filename: 'a.png', mediaType: 'image/png', size: 1, content: 'A', encoding: 'base64' as const },
          { filename: 'notes.json', mediaType: 'application/json', size: 2, content: '{}', encoding: 'text' as const },
          { filename: 'b.jpg', mediaType: 'image/jpeg', size: 1, content: 'B', encoding: 'base64' as const },
        ],
      },
    };

    const content = formatAttachmentToolResponse(result).content;
    expect(content).toHaveLength(3);
    expect(content.slice(1)).toEqual([
      { type: 'image', data: 'A', mimeType: 'image/png' },
      { type: 'image', data: 'B', mimeType: 'image/jpeg' },
    ]);
  });

  it('leaves the response untouched when content was not embedded', () => {
    const result = {
      success: true,
      data: {
        count: 1,
        attachments: [
          {
            filename: 'huge.png',
            mediaType: 'image/png',
            size: 9_000_000,
            contentOmittedReason: 'File size 9000000 bytes exceeds inline cap of 1048576 bytes',
          },
        ],
      },
    };

    expect(formatAttachmentToolResponse(result)).toEqual({ content: [jsonBlock(result)] });
  });

  it('leaves text-encoded and media-type-less attachments untouched', () => {
    const result = {
      success: true,
      data: {
        count: 2,
        attachments: [
          { filename: 'a.png', mediaType: 'image/png', size: 1, content: 'A', encoding: 'text' as const },
          { filename: 'b.bin', size: 1, content: 'B', encoding: 'base64' as const },
        ],
      },
    };

    expect(formatAttachmentToolResponse(result)).toEqual({ content: [jsonBlock(result)] });
  });

  it('passes through failures and unexpected shapes', () => {
    const failure = { success: false, error: 'Error downloading attachment: 404 ' };
    expect(formatAttachmentToolResponse(failure)).toEqual({ content: [jsonBlock(failure)] });
    expect(formatAttachmentToolResponse({ success: true, data: {} })).toEqual({
      content: [jsonBlock({ success: true, data: {} })],
    });
  });
});
