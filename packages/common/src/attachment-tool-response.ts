import { formatToolResponse } from './index.js';
import type { AttachmentDownloadResult } from './attachment-download.js';

/** MCP image blocks require a bare media type; `image/png; charset=binary` is not accepted. */
function normalizeMediaType(mediaType: string): string {
  return mediaType.split(';')[0].trim().toLowerCase();
}

function toImageBlock(
  attachment: AttachmentDownloadResult,
): { type: 'image'; data: string; mimeType: string } | undefined {
  if (attachment.encoding !== 'base64' || typeof attachment.content !== 'string') {
    return undefined;
  }
  const mediaType = attachment.mediaType ? normalizeMediaType(attachment.mediaType) : '';
  if (!mediaType.startsWith('image/')) {
    return undefined;
  }
  return { type: 'image', data: attachment.content, mimeType: mediaType };
}

/**
 * Format an attachment download result, adding a viewable image block per image.
 *
 * `formatToolResponse` serialises everything into a single text block, so an image
 * downloaded with `returnContent: 'base64'` reaches the model as a base64 string it
 * cannot look at. Screenshots and mockups are a common reason to fetch an attachment
 * at all, so images are additionally emitted as MCP `image` content blocks. The JSON
 * block is still first and unchanged, so callers that parse it keep working.
 */
export const formatAttachmentToolResponse = (result: {
  success?: boolean;
  data?: { attachments?: AttachmentDownloadResult[] };
}) => {
  const response = formatToolResponse(result);
  const attachments = result?.data?.attachments;
  if (!Array.isArray(attachments)) {
    return response;
  }

  const images = attachments
    .map(toImageBlock)
    .filter((block): block is { type: 'image'; data: string; mimeType: string } => block !== undefined);

  return images.length > 0 ? { content: [...response.content, ...images] } : response;
};
