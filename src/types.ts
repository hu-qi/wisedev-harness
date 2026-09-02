export const SUPPORTED_AGENTS = ['claude', 'codex', 'cursor'] as const;

export type AgentId = (typeof SUPPORTED_AGENTS)[number];
export type ConflictPolicy = 'fail' | 'overwrite';

export interface HarnessManifest {
  version: 1;
  project: {
    name: string;
  };
  agents: AgentId[];
  resources: {
    skills: string[];
    rules: string[];
  };
  policies: {
    conflict: ConflictPolicy;
  };
}

export type DiagnosticLevel = 'error' | 'warning' | 'info';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  path?: string;
}

export interface ManagedEntry {
  kind: 'file' | 'codex-rules-block';
  path: string;
  hash: string;
  source?: string;
}

export interface HarnessState {
  version: 1;
  manifestHash: string;
  managed: ManagedEntry[];
  syncedAt: string;
}

export interface Operation {
  type: 'write' | 'delete' | 'noop';
  path: string;
  reason: string;
}

export interface SyncResult {
  operations: Operation[];
  diagnostics: Diagnostic[];
  changed: boolean;
}

export interface VerifyResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
