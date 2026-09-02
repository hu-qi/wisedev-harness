import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function markers(id: string) {
  return {
    start: `<!-- ${id}:start -->`,
    end: `<!-- ${id}:end -->`
  };
}

export function renderManagedBlock(id: string, content: string): string {
  const { start, end } = markers(id);
  return `${start}\n${content.trim()}\n${end}`;
}

export function mergeManagedBlock(existing: string, id: string, content: string): string {
  const { start, end } = markers(id);
  const block = renderManagedBlock(id, content);
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`;
  }
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Malformed managed block '${id}'. Refusing to overwrite user content.`);
  }

  const after = endIndex + end.length;
  return `${existing.slice(0, startIndex)}${block}${existing.slice(after)}`;
}

export async function writeManagedBlock(path: string, id: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let existing = '';
  try { existing = await readFile(path, 'utf8'); } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(path, mergeManagedBlock(existing, id, content), 'utf8');
}
