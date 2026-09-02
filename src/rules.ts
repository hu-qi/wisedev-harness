import { CODEX_RULES_END, CODEX_RULES_START } from './constants.js';
import { HarnessError } from './errors.js';
import { sha256 } from './utils.js';

export interface RuleSource {
  source: string;
  content: string;
}

export function buildCodexRulesBlock(rules: RuleSource[]): string | null {
  if (rules.length === 0) return null;
  const sections = rules
    .slice()
    .sort((a, b) => a.source.localeCompare(b.source))
    .map(({ source, content }) => `## Source: ${source}\n\n${content.trim()}\n`)
    .join('\n');

  return `${CODEX_RULES_START}\n# WiseDev Harness managed rules\n\nThis block is generated. Edit the source files under .agents instead.\n\n${sections}${CODEX_RULES_END}`;
}

export function extractCodexRulesBlock(content: string): string | null {
  const start = content.indexOf(CODEX_RULES_START);
  const end = content.indexOf(CODEX_RULES_END);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) {
    throw new HarnessError('MALFORMED_MANAGED_BLOCK', 'AGENTS.md contains an incomplete WiseDev Harness managed rules block');
  }
  const endIndex = end + CODEX_RULES_END.length;
  return content.slice(start, endIndex);
}

export function replaceCodexRulesBlock(content: string, nextBlock: string | null): string {
  const current = extractCodexRulesBlock(content);
  if (current === null) {
    if (nextBlock === null) return content;
    const prefix = content.trimEnd();
    return `${prefix}${prefix ? '\n\n' : ''}${nextBlock}\n`;
  }

  if (nextBlock === null) {
    return content.replace(current, '').replace(/\n{3,}/g, '\n\n').trimEnd() + (content.trim() ? '\n' : '');
  }
  return content.replace(current, nextBlock);
}

export function codexBlockHash(block: string): string {
  return sha256(block);
}
