# arenza-langchain

> LangChain.js + LangGraph tools for **Arenza** — give any agent typed access to AI visibility metrics, GEO opportunities, and brand mention data across ChatGPT, Claude, Gemini, Perplexity, Copilot, and Grok.

[Arenza](https://arenza.ai) is a Generative Engine Optimization (GEO) platform that measures how 6 leading AI assistants describe brands. This package wraps the [Arenza MCP server](https://mcp.arenza.ai) as LangChain `DynamicStructuredTool` instances so a LangChain or LangGraph agent can call them like any other tool — with full Zod schemas, GEO-keyword-rich descriptions for solid tool selection, and the same return shapes as `arenza-mcp-client`.

## Why an Arenza tool plugin (not just a fetch loop)

LangGraph agents that need to answer "how does ChatGPT describe my brand?" or "what should we fix this week to improve our AI search ranking?" benefit from a tool with a tight schema and a clear, GEO-vocabulary description. Hand-rolling fetch calls inside a LangGraph node loses the structured-tool affordance and forces every agent author to re-derive the same parameter shapes.

## Install

```bash
npm install arenza-langchain arenza-mcp-client @langchain/core
# or
pnpm add arenza-langchain arenza-mcp-client @langchain/core
```

`@langchain/core` is a peer dependency — install whichever version your LangChain stack already uses (`>=0.2.0`).

## Quick start (LangGraph)

```ts
import { ArenzaMCPClient } from 'arenza-mcp-client';
import { getArenzaTools } from 'arenza-langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const client = new ArenzaMCPClient({ token: process.env.ARENZA_TOKEN! });

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: 'gpt-4o-mini' }),
  tools: getArenzaTools(client),
  // optional: getArenzaTools(client, { includeWrite: true })  for write tools
});

const res = await agent.invoke({
  messages: [
    { role: 'user', content: 'Which of our brands has the lowest share of voice on Perplexity, and what wrong claims are hurting it?' },
  ],
});

console.log(res.messages.at(-1)?.content);
```

The agent decides on its own which tools to call. A typical trajectory:

1. `arenza_list_brands` — to enumerate the portfolio.
2. `arenza_get_brand_overview` for each — pulling per-LLM mention counts.
3. `arenza_list_opportunities` on the worst brand, filtered to `wrong_claim`.

Then the agent stitches a natural-language answer.

## Quick start (vanilla LangChain.js, single tool call)

```ts
import { ArenzaMCPClient } from 'arenza-mcp-client';
import { getArenzaTools } from 'arenza-langchain';

const client = new ArenzaMCPClient({ token: process.env.ARENZA_TOKEN! });
const [listBrands] = getArenzaTools(client);

const result = await listBrands.invoke({});
console.log(JSON.parse(result));
```

## Tools exposed

`getArenzaTools(client)` returns 6 read-only tools by default:

| Tool name | What it does |
|---|---|
| `arenza_list_brands` | Enumerate brands in the tenant portfolio. |
| `arenza_get_brand_overview` | Share-of-voice + wrong-claim count + per-LLM mentions for one brand. |
| `arenza_list_prompts` | The buyer-perspective prompts being probed for a brand, with mention rate per LLM. |
| `arenza_list_opportunities` | Open GEO opportunities (wrong_claim, missing_canonical_page, listicle_gap, discussion_seed) with severity. |
| `arenza_suggest_competitors` | LLM-suggested competitors to add to tracking. |
| `arenza_suggest_prompts` | LLM-generated buyer-perspective prompts (70%+ unbranded ratio enforced). |

Pass `{ includeWrite: true }` to also get 4 write tools:

| Tool name | What it does |
|---|---|
| `arenza_add_competitor` | Add a competitor to a brand's tracking list. |
| `arenza_dismiss_competitor` | Remove a competitor (e.g. wrong suggestion). |
| `arenza_mark_opportunity_done` | Mark a GEO opportunity as completed. |
| `arenza_generate_geo_article` | Draft a canonical-fact article anchored to a specific finding. |

Write tools are opt-in because LangGraph agents can be aggressive about side effects — you usually want a human in the loop before mutating tracking config.

## Schemas

Each tool ships a Zod schema, so the underlying LLM (Claude, GPT-4, Gemini) sees the parameter shape and types directly. For example:

```ts
// arenza_list_opportunities schema
z.object({
  brand_id: z.string(),
  type: z.enum(['wrong_claim', 'missing_canonical_page', 'listicle_gap', 'discussion_seed']).optional(),
})
```

The descriptions are deliberately GEO-vocabulary-heavy (mentioning ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok by name; mentioning "share of voice", "hallucinations", "AI visibility") so when an agent's prompt mentions any of those terms the tool router has high signal.

## Authentication

Pass an Arenza API token to the client:

```ts
const client = new ArenzaMCPClient({ token: process.env.ARENZA_TOKEN! });
```

Get a token at [app.arenza.ai/settings/api](https://app.arenza.ai/settings/api). For multi-tenant deployments, swap to OAuth — the MCP server publishes its OAuth metadata at [`mcp.arenza.ai/.well-known/oauth-authorization-server`](https://mcp.arenza.ai/.well-known/oauth-authorization-server).

## Pattern: weekly GEO triage agent

```ts
import { ArenzaMCPClient } from 'arenza-mcp-client';
import { getArenzaTools } from 'arenza-langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const client = new ArenzaMCPClient({ token: process.env.ARENZA_TOKEN! });
const tools = getArenzaTools(client, { includeWrite: true });

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-sonnet-4-5' }),
  tools,
});

const triage = await agent.invoke({
  messages: [
    {
      role: 'system',
      content:
        'You are a GEO marketing triage agent. Each Monday you review the Arenza portfolio. ' +
        'For every brand: list overview, list critical-severity opportunities, draft canonical articles ' +
        'for any wrong-claim opportunity that is older than 7 days, and produce a one-paragraph human summary.',
    },
    {
      role: 'user',
      content: 'Run this week\'s triage.',
    },
  ],
});
```

Combine with [LangGraph persistence](https://langchain-ai.github.io/langgraphjs/concepts/persistence/) to make it stateful across weeks.

## Pattern: GEO copilot inside your existing agent

If you already have a customer-facing agent, drop the read-only Arenza tools into the existing tool array — the agent now answers "how am I doing on AI search?" without you wiring custom routes:

```ts
const agent = createReactAgent({
  llm,
  tools: [
    ...yourExistingTools,
    ...getArenzaTools(client),  // adds 6 GEO tools
  ],
});
```

## Related projects

- [`arenza-mcp-client`](https://github.com/naiqiao/arenza-mcp-client-ts) — the typed TS client this wraps.
- [`arenza-mcp-client-python`](https://github.com/naiqiao/arenza-mcp-client-python) — Python equivalent.
- [`arenza-cli`](https://github.com/naiqiao/arenza-cli) — `npx arenza scan brand.com` for terminal scans.
- [`arenza-llamaindex`](https://github.com/naiqiao/arenza-llamaindex) — same six tools wrapped for LlamaIndex.
- [`arenza-vercel-ai-sdk`](https://github.com/naiqiao/arenza-vercel-ai-sdk) — Vercel AI SDK provider.
- [`arenza-zapier-actions`](https://github.com/naiqiao/arenza-zapier-actions) — Zapier integration manifest.
- [awesome-geo](https://github.com/naiqiao/awesome-geo) — curated list of GEO and AI-visibility resources.

## Resources

- Arenza homepage: https://arenza.ai
- Long-form GEO guides: https://arenza.ai/guides
- AI brand reference: https://arenza.ai/llms.txt + https://arenza.ai/llms-full.txt
- MCP server: https://mcp.arenza.ai
- OAuth spec: https://mcp.arenza.ai/.well-known/oauth-authorization-server
- LangChain docs: https://js.langchain.com

## License

MIT (c) 2026 Arenza
