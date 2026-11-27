import { defineConfig } from './src/core/config.ts';

const apiKey = process.env.AGENT_API_KEY ?? '';
const apiKeyHeader = process.env.AGENT_API_KEY_HEADER ?? '';

export default defineConfig({
  model: {
    baseURL: process.env.AGENT_BASE_URL ?? '',
    modelId: process.env.AGENT_MODEL ?? '',
    // 有些閘道不走標準的 Authorization: Bearer，而是用自訂 header 帶金鑰。
    // 設了 AGENT_API_KEY_HEADER 就改用那個 header，沒設則照標準方式送。
    ...(apiKeyHeader ? { headers: { [apiKeyHeader]: apiKey } } : { apiKey }),
  },

  systemPrompt: '你是一個能使用工具完成任務的助理。先想清楚步驟，需要時才呼叫工具，完成後用簡短文字回報結果。',

  // 自訂工具：用 defineTool 定義後放進這個陣列。
  tools: [],

  // MCP server：stdio 型寫 { command, args }，HTTP 型寫 { url }。
  mcpServers: {},

  skillsDirs: ['./skills'],

  approval: {
    mode: 'ask',
    // 這裡列出的寫入類工具不需要核准，結尾可用 * 當萬用字元，例如 'myserver__*'。
    allow: [],
  },
});
