import { describe, expect, it } from 'vitest';
import { mergeManagedBlock } from '../src/managed-block.js';

describe('mergeManagedBlock', () => {
  it('preserves existing user content', () => {
    const out = mergeManagedBlock('# User rules\n', 'wisedev-harness', 'generated');
    expect(out).toContain('# User rules');
    expect(out).toContain('<!-- wisedev-harness:start -->\ngenerated\n<!-- wisedev-harness:end -->');
  });

  it('updates its own block idempotently', () => {
    const first = mergeManagedBlock('', 'wisedev-harness', 'v1');
    const second = mergeManagedBlock(first, 'wisedev-harness', 'v2');
    expect(second).toContain('v2');
    expect(second).not.toContain('v1');
    expect(second.match(/wisedev-harness:start/g)).toHaveLength(1);
  });

  it('refuses malformed markers', () => {
    expect(() => mergeManagedBlock('<!-- wisedev-harness:start -->\nbroken', 'wisedev-harness', 'new')).toThrow(/Malformed managed block/);
  });
});
