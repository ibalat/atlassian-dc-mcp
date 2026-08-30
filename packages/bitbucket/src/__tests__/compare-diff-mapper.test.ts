import { formatCompareDiffAsUnified } from '../compare-diff-mapper.js';

describe('formatCompareDiffAsUnified', () => {
  it('should report an empty comparison', () => {
    expect(formatCompareDiffAsUnified({ diffs: [] })).toBe('No differences found.');
    expect(formatCompareDiffAsUnified({})).toBe('No differences found.');
  });

  it('should render added and removed files against /dev/null', () => {
    const result = formatCompareDiffAsUnified({
      diffs: [
        {
          source: null,
          destination: { toString: 'new-file.js' },
          hunks: [
            {
              sourceLine: 0,
              sourceSpan: 0,
              destinationLine: 1,
              destinationSpan: 1,
              segments: [{ type: 'ADDED', lines: [{ line: 'export const a = 1;' }] }]
            }
          ]
        },
        {
          source: { toString: 'old-file.js' },
          destination: null,
          hunks: [
            {
              sourceLine: 1,
              sourceSpan: 1,
              destinationLine: 0,
              destinationSpan: 0,
              segments: [{ type: 'REMOVED', lines: [{ line: 'export const b = 2;' }] }]
            }
          ]
        }
      ]
    });

    expect(result).toBe(
      'diff --git a/new-file.js b/new-file.js\n' +
      '--- /dev/null\n' +
      '+++ b/new-file.js\n' +
      '@@ -0,0 +1,1 @@\n' +
      '+export const a = 1;\n' +
      'diff --git a/old-file.js b/old-file.js\n' +
      '--- a/old-file.js\n' +
      '+++ /dev/null\n' +
      '@@ -1,1 +0,0 @@\n' +
      '-export const b = 2;'
    );
  });

  it('should note files without a textual diff', () => {
    const result = formatCompareDiffAsUnified({
      diffs: [{ source: { toString: 'logo.png' }, destination: { toString: 'logo.png' } }]
    });

    expect(result).toContain('[no textual diff available]');
  });

  it('should surface server-side truncation at hunk, file and diff level', () => {
    const result = formatCompareDiffAsUnified({
      truncated: true,
      diffs: [
        {
          source: { toString: 'big.txt' },
          destination: { toString: 'big.txt' },
          truncated: true,
          hunks: [{ sourceLine: 1, sourceSpan: 1, destinationLine: 1, destinationSpan: 1, segments: [], truncated: true }]
        }
      ]
    });

    expect(result).toContain('[hunk truncated by the Bitbucket server]');
    expect(result).toContain('[file diff truncated by the Bitbucket server]');
    expect(result).toContain('[diff truncated by the Bitbucket server; narrow the comparison with `path`]');
  });

  it('should prefix segments by type and default unknown types to context', () => {
    const result = formatCompareDiffAsUnified({
      diffs: [
        {
          source: { toString: 'f.txt' },
          destination: { toString: 'f.txt' },
          hunks: [
            {
              sourceLine: 10,
              sourceSpan: 3,
              destinationLine: 10,
              destinationSpan: 4,
              segments: [
                { type: 'CONTEXT', lines: [{ line: 'keep' }] },
                { type: 'REMOVED', lines: [{ line: 'gone' }] },
                { type: 'ADDED', lines: [{ line: 'fresh' }] },
                { type: 'SOMETHING_NEW', lines: [{ line: 'unknown' }] }
              ]
            }
          ]
        }
      ]
    });

    expect(result).toBe(
      'diff --git a/f.txt b/f.txt\n' +
      '--- a/f.txt\n' +
      '+++ b/f.txt\n' +
      '@@ -10,3 +10,4 @@\n' +
      ' keep\n' +
      '-gone\n' +
      '+fresh\n' +
      ' unknown'
    );
  });
});
