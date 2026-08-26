// Shape of the `RestDiff` payload returned by the Bitbucket compare/diff resource.
interface DiffLine {
  line: string;
  truncated?: boolean;
}

interface DiffSegment {
  type: string;
  lines?: DiffLine[];
}

interface DiffHunk {
  sourceLine?: number;
  sourceSpan?: number;
  destinationLine?: number;
  destinationSpan?: number;
  segments?: DiffSegment[];
  truncated?: boolean;
}

interface FileDiff {
  source?: { toString: string } | null;
  destination?: { toString: string } | null;
  hunks?: DiffHunk[];
  truncated?: boolean;
}

export interface CompareDiffResponse {
  fromHash?: string;
  toHash?: string;
  diffs?: FileDiff[];
  truncated?: boolean;
}

const SEGMENT_PREFIXES: Record<string, string> = {
  ADDED: '+',
  REMOVED: '-',
  CONTEXT: ' ',
};

function renderHunk(hunk: DiffHunk, out: string[]): void {
  out.push(`@@ -${hunk.sourceLine ?? 0},${hunk.sourceSpan ?? 0} +${hunk.destinationLine ?? 0},${hunk.destinationSpan ?? 0} @@`);
  for (const segment of hunk.segments ?? []) {
    const prefix = SEGMENT_PREFIXES[segment.type] ?? ' ';
    for (const line of segment.lines ?? []) {
      out.push(`${prefix}${line.line}`);
    }
  }
  if (hunk.truncated) {
    out.push('[hunk truncated by the Bitbucket server]');
  }
}

function renderFile(file: FileDiff, out: string[]): void {
  // A missing source means the file was added, a missing destination that it was deleted.
  const source = file.source?.toString;
  const destination = file.destination?.toString;
  const oldPath = source ? `a/${source}` : '/dev/null';
  const newPath = destination ? `b/${destination}` : '/dev/null';

  out.push(`diff --git ${source ? `a/${source}` : `a/${destination}`} ${destination ? `b/${destination}` : `b/${source}`}`);
  out.push(`--- ${oldPath}`);
  out.push(`+++ ${newPath}`);

  const hunks = file.hunks ?? [];
  if (hunks.length === 0) {
    // Bitbucket omits hunks for binary files and for pure mode/rename changes.
    out.push('[no textual diff available]');
  }
  for (const hunk of hunks) {
    renderHunk(hunk, out);
  }
  if (file.truncated) {
    out.push('[file diff truncated by the Bitbucket server]');
  }
}

/**
 * Render a Bitbucket `RestDiff` payload as a unified diff.
 *
 * The compare resource only speaks JSON (it answers 406 to `Accept: text/plain`, unlike the
 * pull request diff resource), so the structured payload is folded into the far more compact
 * unified format that models already understand.
 */
export function formatCompareDiffAsUnified(diff: CompareDiffResponse): string {
  const files = diff.diffs ?? [];
  if (files.length === 0) {
    return 'No differences found.';
  }

  const out: string[] = [];
  for (const file of files) {
    renderFile(file, out);
  }
  if (diff.truncated) {
    out.push('[diff truncated by the Bitbucket server; narrow the comparison with `path`]');
  }
  return out.join('\n');
}
