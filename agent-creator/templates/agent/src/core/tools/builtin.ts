import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from '#deps';
import { defineTool } from './registry.ts';
import type { AgentTool, ToolContext } from './registry.ts';

export const READ_CHUNK_CHARS = 6_000;
const MAX_COMMAND_OUTPUT_CHARS = 200_000;
const IS_WINDOWS = process.platform === 'win32';
const FORCE_KILL_GRACE_MS = 2_000;

export class PathNotAllowedError extends Error {
  constructor(requested: string) {
    super(`路徑 ${requested} 不在允許的範圍內`);
    this.name = 'PathNotAllowedError';
  }
}

function realpathOfExistingAncestor(target: string): string {
  let current = target;
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return target;
    missing.unshift(current.slice(parent.length).replace(/^[\\/]/, ''));
    current = parent;
  }
  return resolve(realpathSync(current), ...missing);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(realpathOfExistingAncestor(root), target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

// 相對路徑一律以 workspace 為基準；絕對路徑或含 .. 的路徑，解析後（含符號連結）必須仍落在允許的根目錄內。
export function resolveAllowedPath(requested: string, workspaceDir: string, allowedRoots: string[]): string {
  const target = realpathOfExistingAncestor(isAbsolute(requested) ? requested : resolve(workspaceDir, requested));
  if (!allowedRoots.some((root) => isInside(root, target))) throw new PathNotAllowedError(requested);
  return target;
}

function shellInvocation(command: string): { file: string; args: string[] } {
  if (IS_WINDOWS) {
    // PowerShell 預設用系統 ANSI 字碼頁輸出，中文會變亂碼，所以先把輸出編碼切成 UTF-8。
    const utf8Prefix = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ';
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', utf8Prefix + command] };
  }
  return { file: '/bin/sh', args: ['-c', command] };
}

function killProcessTree(pid: number): void {
  if (IS_WINDOWS) {
    // Windows 上 child.kill 只會結束 shell 本身，子行程會變成孤兒，要用 taskkill /T 連同子行程一起結束。
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* 行程已結束 */ }
    }, FORCE_KILL_GRACE_MS).unref();
  } catch { /* 行程已結束 */ }
}

function runCommand(command: string, cwd: string, timeoutMs: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolvePromise) => {
    const { file, args } = shellInvocation(command);
    const child = spawn(file, args, { cwd, detached: !IS_WINDOWS, windowsHide: true });
    let output = '';
    let truncated = false;
    let endedBy: 'exit' | 'timeout' | 'abort' = 'exit';
    const collect = (chunk: Buffer) => {
      if (output.length >= MAX_COMMAND_OUTPUT_CHARS) { truncated = true; return; }
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const stop = (reason: 'timeout' | 'abort') => {
      endedBy = reason;
      if (child.pid !== undefined) killProcessTree(child.pid);
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const onAbort = () => stop('abort');
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = (status: string) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const notes = [
        truncated ? `[輸出超過 ${MAX_COMMAND_OUTPUT_CHARS} 字元，後段已丟棄]` : '',
        endedBy === 'timeout' ? `[超過 ${timeoutMs} 毫秒，已強制結束]` : '',
        endedBy === 'abort' ? '[使用者中斷，已強制結束]' : '',
      ].filter(Boolean).join('\n');
      resolvePromise([status, output.trimEnd(), notes].filter(Boolean).join('\n'));
    };
    child.on('error', (err) => finish(`無法啟動指令：${err.message}`));
    child.on('close', (code) => finish(`exit code: ${code ?? '被強制結束'}`));
  });
}

export function createBuiltinTools(options: { readableRoots: string[]; commandTimeoutMs: number }): AgentTool[] {
  const readRoots = (ctx: ToolContext) => [ctx.workspaceDir, ctx.toolResultsDir, ...options.readableRoots];

  const readFile = defineTool({
    name: 'read_file',
    description: `讀取文字檔。相對路徑以 workspace 為基準。一次最多回傳 ${READ_CHUNK_CHARS} 字元，較大的檔案用 offset 分段讀。`,
    risk: 'read',
    inputSchema: z.object({
      path: z.string().describe('檔案路徑'),
      offset: z.number().int().min(0).optional().describe('從第幾個字元開始，預設 0'),
    }),
    async execute(input: { path: string; offset?: number }, ctx) {
      const file = resolveAllowedPath(input.path, ctx.workspaceDir, readRoots(ctx));
      const text = readFileSync(file, 'utf8');
      const offset = input.offset ?? 0;
      const chunk = text.slice(offset, offset + READ_CHUNK_CHARS);
      const end = offset + chunk.length;
      const more = end < text.length ? `\n[檔案共 ${text.length} 字元，目前讀到 ${end}，用 offset=${end} 繼續]` : '';
      return chunk + more;
    },
  });

  const writeFile = defineTool({
    name: 'write_file',
    description: '把文字寫入 workspace 內的檔案，會覆寫既有內容，自動建立上層資料夾。',
    risk: 'write',
    inputSchema: z.object({
      path: z.string().describe('workspace 內的檔案路徑'),
      content: z.string().describe('完整檔案內容'),
    }),
    async execute(input: { path: string; content: string }, ctx) {
      const file = resolveAllowedPath(input.path, ctx.workspaceDir, [ctx.workspaceDir]);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, input.content);
      return `已寫入 ${file}（${input.content.length} 字元）`;
    },
  });

  const listDir = defineTool({
    name: 'list_dir',
    description: '列出資料夾內容。相對路徑以 workspace 為基準，不給路徑就列出 workspace。',
    risk: 'read',
    inputSchema: z.object({ path: z.string().optional().describe('資料夾路徑') }),
    async execute(input: { path?: string }, ctx) {
      const dir = resolveAllowedPath(input.path ?? '.', ctx.workspaceDir, readRoots(ctx));
      const entries = readdirSync(dir, { withFileTypes: true }).map((entry) => {
        if (entry.isDirectory()) return `${entry.name}/`;
        return `${entry.name}  (${statSync(resolve(dir, entry.name)).size} bytes)`;
      });
      return entries.length > 0 ? entries.join('\n') : '(空資料夾)';
    },
  });

  const shellName = IS_WINDOWS ? 'PowerShell' : 'sh';
  const runCommandTool = defineTool({
    name: 'run_command',
    description: `在 workspace 資料夾執行一行 ${shellName} 指令，回傳 exit code 與輸出。指令不受 workspace 限制，可影響整台電腦，所以每次都要使用者核准。`,
    risk: 'write',
    inputSchema: z.object({ command: z.string().describe(`要執行的 ${shellName} 指令`) }),
    async execute(input: { command: string }, ctx) {
      return runCommand(input.command, ctx.workspaceDir, options.commandTimeoutMs, ctx.signal);
    },
  });

  return [readFile, writeFile, listDir, runCommandTool];
}
