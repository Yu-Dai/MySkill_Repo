import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from '#deps';
import { defineTool } from './tools/registry.ts';
import type { AgentTool } from './tools/registry.ts';

const SKILL_FILE = 'SKILL.md';
export const LOAD_SKILL_TOOL_NAME = 'load_skill';
const FRONTMATTER_FENCE = '---';

export type SkillEntry = { name: string; description: string; dir: string; file: string };

// 只支援「key: 單行值」的 frontmatter，這是 SKILL.md 的慣用寫法；多行 YAML 值不會被讀到。
function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return { fields: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_FENCE);
  if (end === -1) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: lines.slice(end + 1).join('\n').trim() };
}

export function loadSkillIndex(skillsDirs: string[]): SkillEntry[] {
  const skills: SkillEntry[] = [];
  for (const root of skillsDirs) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const file = join(dir, SKILL_FILE);
      if (!existsSync(file)) continue;
      const { fields } = parseFrontmatter(readFileSync(file, 'utf8'));
      const name = fields.name || entry.name;
      if (skills.some((s) => s.name === name)) continue;
      skills.push({ name, description: fields.description ?? '', dir, file });
    }
  }
  return skills;
}

export function renderSkillIndex(skills: SkillEntry[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name}：${s.description}`);
  return [
    '## 可用的 Skill',
    '以下每個 skill 是一份針對特定工作的操作說明。任務符合某個 skill 的描述時，先呼叫 load_skill 讀取完整說明，再照說明做。',
    ...lines,
  ].join('\n');
}

export function createLoadSkillTool(skills: SkillEntry[]): AgentTool {
  return defineTool({
    name: LOAD_SKILL_TOOL_NAME,
    description: '讀取某個 skill 的完整說明。name 必須是系統提示裡列出的 skill 名稱。',
    risk: 'read',
    inputSchema: z.object({ name: z.string().describe('skill 名稱') }),
    async execute(input: { name: string }) {
      const skill = skills.find((s) => s.name === input.name);
      if (!skill) {
        const available = skills.map((s) => s.name).join('、') || '(沒有任何 skill)';
        throw new Error(`找不到 skill「${input.name}」。可用的有：${available}`);
      }
      const { body } = parseFrontmatter(readFileSync(skill.file, 'utf8'));
      return `SKILL_DIR = ${skill.dir}\n（說明中提到的檔案都在這個資料夾，可用 read_file 讀取）\n\n${body}`;
    },
  });
}
