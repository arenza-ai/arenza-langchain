/**
 * Build a set of LangChain `DynamicStructuredTool` instances backed by
 * an `ArenzaMCPClient`. Each tool's description is GEO-keyword-rich so
 * the LLM scheduling the tools picks the right one when a user asks
 * about AI visibility, brand mentions, or hallucinations.
 *
 * Six tools are exposed (read-only by default — write tools are opt-in
 * via the `includeWrite` flag because LangGraph agents can be aggressive
 * about calling them).
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import type { ArenzaMCPClient } from '@arenza/mcp-client';
import { z } from 'zod';

export interface GetArenzaToolsOptions {
  /** Include write tools (add_competitor, dismiss_competitor, mark_opportunity_done, generate_geo_article). Default: false. */
  includeWrite?: boolean;
}

const intentSchema = z
  .enum(['discovery', 'comparison', 'how_to', 'integration', 'pricing'])
  .optional()
  .describe('Optional intent filter — narrow probed prompts to a buyer journey stage.');

const oppTypeSchema = z
  .enum(['wrong_claim', 'missing_canonical_page', 'listicle_gap', 'discussion_seed'])
  .optional()
  .describe('Optional GEO opportunity type filter.');

const localeSchema = z
  .enum(['en', 'zh'])
  .optional()
  .describe('Locale for prompt suggestions (default: en).');

/**
 * Return the array of LangChain tools wrapping the Arenza MCP server.
 */
export function getArenzaTools(
  client: ArenzaMCPClient,
  opts: GetArenzaToolsOptions = {},
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [
    new DynamicStructuredTool({
      name: 'arenza_list_brands',
      description:
        'List all brands tracked in the authenticated Arenza tenant. Returns brand id, name, domain, and region. Use this first when the user asks about "my brands", "the brands we track", or wants to know which company to drill into next.',
      schema: z.object({}),
      func: async () => {
        const brands = await client.listBrands();
        return JSON.stringify(brands);
      },
    }),

    new DynamicStructuredTool({
      name: 'arenza_get_brand_overview',
      description:
        'Aggregate AI visibility + accuracy snapshot for one brand. Returns share-of-voice, count of wrong claims (hallucinations), per-LLM mention counts across ChatGPT, Claude, Gemini, Perplexity, Copilot, and Grok, plus last-scan timestamp. Call this when the user asks how a brand is performing in AI search / GEO / LLM visibility.',
      schema: z.object({
        brand_id: z.string().describe('Brand id from arenza_list_brands.'),
      }),
      func: async ({ brand_id }) => {
        const ovw = await client.getBrandOverview({ brand_id });
        return JSON.stringify(ovw);
      },
    }),

    new DynamicStructuredTool({
      name: 'arenza_list_prompts',
      description:
        'List the AI prompts probed for a brand (the buyer-perspective questions Arenza asks every assistant). Each prompt comes back with its intent, branded/unbranded flag, and per-LLM mention rate. Use when the user asks "what questions are we measuring" or wants to find prompts where coverage is weak.',
      schema: z.object({
        brand_id: z.string().describe('Brand id.'),
        intent: intentSchema,
      }),
      func: async ({ brand_id, intent }) => {
        const prompts = await client.listPrompts({ brand_id, intent });
        return JSON.stringify(prompts);
      },
    }),

    new DynamicStructuredTool({
      name: 'arenza_list_opportunities',
      description:
        'List measurement-led GEO opportunities for a brand. Each opportunity is anchored to a specific finding (wrong_claim, missing_canonical_page, listicle_gap, discussion_seed) with a severity. This is the "what should we fix this week" list. Critical-severity opportunities usually represent hallucinated claims by ChatGPT/Claude/Gemini/Perplexity/Copilot/Grok that hurt buying decisions.',
      schema: z.object({
        brand_id: z.string().describe('Brand id.'),
        type: oppTypeSchema,
      }),
      func: async ({ brand_id, type }) => {
        const opps = await client.listOpportunities({ brand_id, type });
        return JSON.stringify(opps);
      },
    }),

    new DynamicStructuredTool({
      name: 'arenza_suggest_competitors',
      description:
        'Get LLM-suggested competitors for a brand based on its description and category. Useful when setting up tracking for a new brand or when the user wants to know who else AI assistants might be comparing them against.',
      schema: z.object({
        brand_id: z.string().describe('Brand id.'),
        count: z.number().int().min(1).max(20).optional().describe('How many to suggest (default 5).'),
      }),
      func: async ({ brand_id, count }) => {
        const sugg = await client.suggestCompetitors({ brand_id, count });
        return JSON.stringify(sugg);
      },
    }),

    new DynamicStructuredTool({
      name: 'arenza_suggest_prompts',
      description:
        'Generate buyer-perspective prompts to add to a brand\'s tracking set. Arenza enforces a 70%+ unbranded ratio so the prompts measure real discovery, not vanity searches. Pass the competitor list to get comparison-style prompts ("X vs Y for use case Z").',
      schema: z.object({
        brand_id: z.string().describe('Brand id.'),
        competitors: z.array(z.string()).optional().describe('Competitor names to seed comparison prompts.'),
        count: z.number().int().min(1).max(50).optional(),
        locale: localeSchema,
      }),
      func: async ({ brand_id, competitors, count, locale }) => {
        const sugg = await client.suggestPrompts({ brand_id, competitors, count, locale });
        return JSON.stringify(sugg);
      },
    }),
  ];

  if (opts.includeWrite) {
    tools.push(
      new DynamicStructuredTool({
        name: 'arenza_add_competitor',
        description:
          'Add a competitor to a brand\'s tracking list. Subsequent AI visibility scans will compare share-of-voice against this competitor across ChatGPT, Claude, Gemini, Perplexity, Copilot, and Grok.',
        schema: z.object({
          brand_id: z.string(),
          name: z.string().describe('Competitor name as it should appear in the dashboard.'),
          domain: z.string().describe('Competitor domain, e.g. "stripe.com".'),
        }),
        func: async ({ brand_id, name, domain }) => {
          const c = await client.addCompetitor({ brand_id, name, domain });
          return JSON.stringify(c);
        },
      }),

      new DynamicStructuredTool({
        name: 'arenza_dismiss_competitor',
        description:
          'Remove a competitor from a brand\'s tracking list. Use when an LLM-suggested competitor turned out to be wrong or no longer relevant.',
        schema: z.object({
          brand_id: z.string(),
          competitor_id: z.string(),
        }),
        func: async ({ brand_id, competitor_id }) => {
          const r = await client.dismissCompetitor({ brand_id, competitor_id });
          return JSON.stringify(r);
        },
      }),

      new DynamicStructuredTool({
        name: 'arenza_mark_opportunity_done',
        description:
          'Mark a GEO opportunity as completed (e.g. you published the canonical page or got the wrong claim retracted). Arenza will re-verify on the next scan.',
        schema: z.object({
          opportunity_id: z.string(),
        }),
        func: async ({ opportunity_id }) => {
          const r = await client.markOpportunityDone({ opportunity_id });
          return JSON.stringify(r);
        },
      }),

      new DynamicStructuredTool({
        name: 'arenza_generate_geo_article',
        description:
          'Draft a canonical-fact article body anchored to a specific finding (linked_claim_id). Use to fix wrong_claim or missing_canonical_page opportunities. Output is a structured doc the marketing team can publish to correct hallucinations across ChatGPT, Claude, Gemini, Perplexity, Copilot, and Grok.',
        schema: z.object({
          brand_id: z.string(),
          linked_claim_id: z.string().describe('Claim id from a list_opportunities result.'),
          locale: localeSchema,
        }),
        func: async ({ brand_id, linked_claim_id, locale }) => {
          const a = await client.generateGeoArticle({ brand_id, linked_claim_id, locale });
          return JSON.stringify(a);
        },
      }),
    );
  }

  return tools;
}
