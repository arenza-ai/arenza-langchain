/**
* @arenza/langchain — LangChain.js tool wrappers for the Arenza GEO platform.
 *
 * Drop the result of `getArenzaTools(client)` into any LangChain or
 * LangGraph agent that accepts a `tools: DynamicStructuredTool[]` array.
 * The agent can then ask Arenza about brand visibility across ChatGPT,
 * Claude, Gemini, Perplexity, Copilot, and Grok — and execute
 * measurement-led GEO opportunities back to the dashboard.
 *
 * Quick wiring:
 *
 *     import { ArenzaMCPClient } from '@arenza/mcp-client';
 *     import { getArenzaTools } from '@arenza/langchain';
 *     import { createReactAgent } from '@langchain/langgraph/prebuilt';
 *
 *     const client = new ArenzaMCPClient({ token: process.env.ARENZA_TOKEN! });
 *     const agent = createReactAgent({ llm, tools: getArenzaTools(client) });
 *
 * For non-LangChain consumers, use `arenza-mcp-client` directly.
 */

export { getArenzaTools } from './tools.js';
export type { GetArenzaToolsOptions } from './tools.js';
