import { HarnessError } from './errors.js';
import type { Diagnostic } from './types.js';
import { exists, readUtf8, resolveInside } from './utils.js';

export const OPENCODE_CONFIG_PATH = 'opencode.json';
export const OPENCODE_RULES_GLOB = '.opencode/rules/wisedev/**/*.md';

export interface OpenCodeConfigPlan {
  changed: boolean;
  content?: string;
  diagnostics: Diagnostic[];
}

function parseConfig(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new HarnessError('OPENCODE_CONFIG_INVALID', 'opencode.json is not valid JSON; refusing to rewrite it', { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessError('OPENCODE_CONFIG_INVALID', 'opencode.json must contain a JSON object');
  }
  return value as Record<string, unknown>;
}

export async function planOpenCodeInstructions(root: string, present: boolean): Promise<OpenCodeConfigPlan> {
  const target = resolveInside(root, OPENCODE_CONFIG_PATH);
  const fileExists = await exists(target);
  if (!fileExists && !present) return { changed: false, diagnostics: [] };

  try {
    const data = fileExists ? parseConfig(await readUtf8(target)) : {};
    const rawInstructions = data.instructions;
    if (rawInstructions !== undefined && !Array.isArray(rawInstructions)) {
      return {
        changed: false,
        diagnostics: [{ level: 'error', code: 'OPENCODE_INSTRUCTIONS_INVALID', message: 'opencode.json instructions must be an array before WiseDev can manage its entry', path: OPENCODE_CONFIG_PATH }],
      };
    }

    const instructions = Array.isArray(rawInstructions) ? [...rawInstructions] : [];
    const hasManagedGlob = instructions.includes(OPENCODE_RULES_GLOB);
    if ((present && hasManagedGlob) || (!present && !hasManagedGlob)) {
      return { changed: false, diagnostics: [] };
    }

    const next = present
      ? [...instructions, OPENCODE_RULES_GLOB]
      : instructions.filter((entry) => entry !== OPENCODE_RULES_GLOB);

    if (next.length === 0) delete data.instructions;
    else data.instructions = next;

    return { changed: true, content: `${JSON.stringify(data, null, 2)}\n`, diagnostics: [] };
  } catch (error) {
    return {
      changed: false,
      diagnostics: [{ level: 'error', code: error instanceof HarnessError ? error.code : 'OPENCODE_CONFIG_ERROR', message: error instanceof Error ? error.message : String(error), path: OPENCODE_CONFIG_PATH }],
    };
  }
}

export async function verifyOpenCodeInstructions(root: string): Promise<Diagnostic[]> {
  const target = resolveInside(root, OPENCODE_CONFIG_PATH);
  if (!(await exists(target))) {
    return [{ level: 'error', code: 'OPENCODE_CONFIG_MISSING', message: `OpenCode rules require ${OPENCODE_CONFIG_PATH}`, path: OPENCODE_CONFIG_PATH }];
  }
  try {
    const data = parseConfig(await readUtf8(target));
    if (!Array.isArray(data.instructions) || !data.instructions.includes(OPENCODE_RULES_GLOB)) {
      return [{ level: 'error', code: 'OPENCODE_RULES_NOT_ACTIVATED', message: `opencode.json instructions is missing ${OPENCODE_RULES_GLOB}`, path: OPENCODE_CONFIG_PATH }];
    }
    return [];
  } catch (error) {
    return [{ level: 'error', code: error instanceof HarnessError ? error.code : 'OPENCODE_CONFIG_ERROR', message: error instanceof Error ? error.message : String(error), path: OPENCODE_CONFIG_PATH }];
  }
}
