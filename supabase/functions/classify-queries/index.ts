import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ---------------------------------------------------------------------------
// CORS — origins are controlled by the ALLOWED_ORIGINS edge-function secret.
// Format: comma-separated list of allowed origins. Wildcards in the form
// "https://*.lovable.app" are supported (one wildcard segment only).
// Default covers local dev and Lovable preview URLs; add your Vercel
// production URL via: npx supabase secrets set ALLOWED_ORIGINS=...
// ---------------------------------------------------------------------------
const RAW_ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ??
  "http://localhost:8080,https://*.lovable.app";

const ALLOWED_ORIGINS: Array<string | RegExp> = RAW_ALLOWED_ORIGINS
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => {
    if (o.includes("*")) {
      // Convert "https://*.lovable.app" → /^https:\/\/[^.]+\.lovable\.app$/
      const escaped = o
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace("\\*", "[^.]+");
      return new RegExp(`^${escaped}$`);
    }
    return o;
  });

function getAllowedOriginHeader(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  for (const allowed of ALLOWED_ORIGINS) {
    if (typeof allowed === "string") {
      if (allowed === requestOrigin) return requestOrigin;
    } else {
      if (allowed.test(requestOrigin)) return requestOrigin;
    }
  }
  return null;
}

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getAllowedOriginHeader(requestOrigin);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

// ---------------------------------------------------------------------------

interface NERRequest {
  queries: string[];
}

interface Entity {
  type: "PERSON" | "ORGANIZATION" | "LOCATION" | "EVENT";
  name: string;
}

interface NERResult {
  query: string;
  entities: Entity[];
  isNewsEntity: boolean;
}

async function extractEntitiesWithOpenAI(
  queries: string[],
): Promise<NERResult[]> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  if (!OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not configured");
    return queries.map((query) => ({ query, entities: [], isNewsEntity: false }));
  }

  const systemPrompt =
    `You are a precise NER system. Output ONLY valid JSON, no markdown, no explanation.

For each search query, extract named entities (PERSON, ORGANIZATION, LOCATION, EVENT) that indicate news or current events interest.

Focus on:
- PERSON: Politicians, celebrities, public figures (e.g., "Trump", "Biden", "Elon Musk")
- ORGANIZATION: Companies, governments, institutions in news context (e.g., "NATO", "Tesla", "FBI")
- LOCATION: Countries, cities, regions in geopolitical/news context (e.g., "Ukraine", "Gaza", "Taiwan")
- EVENT: Named events, conflicts, elections (e.g., "World Cup", "Ukraine war", "2024 election")

Return JSON array format:
[
  {"query": "trump news today", "entities": [{"type": "PERSON", "name": "Trump"}], "isNewsEntity": true},
  {"query": "best laptop 2024", "entities": [], "isNewsEntity": false}
]

A query is "isNewsEntity: true" ONLY if it contains recognizable named entities that suggest news/current events interest.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: queries.map((q, i) => `${i + 1}. ${q}`).join("\n"),
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI API error:", response.status, error);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    const parsed = JSON.parse(content);
    const results = parsed.results || parsed.queries || parsed;

    if (Array.isArray(results)) {
      return results.map((r: any, i: number) => ({
        query: r.query || queries[i],
        entities: r.entities || [],
        isNewsEntity: r.isNewsEntity === true,
      }));
    }

    // Handle object response format
    return queries.map((query) => {
      const match = results[query];
      return {
        query,
        entities: match?.entities || [],
        isNewsEntity: match?.isNewsEntity === true,
      };
    });
  } catch (error) {
    console.error("OpenAI NER error:", error);
    return queries.map((query) => ({
      query,
      entities: [],
      isNewsEntity: false,
    }));
  }
}

serve(async (req) => {
  const requestOrigin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(requestOrigin) });
  }

  try {
    const { queries }: NERRequest = await req.json();

    if (!queries || !Array.isArray(queries)) {
      return new Response(
        JSON.stringify({ error: "queries must be an array" }),
        {
          status: 400,
          headers: {
            ...corsHeaders(requestOrigin),
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Process in batches of 50 to avoid token limits
    const BATCH_SIZE = 50;
    const results: NERResult[] = [];

    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);
      const batchResults = await extractEntitiesWithOpenAI(batch);
      results.push(...batchResults);
    }

    return new Response(JSON.stringify({ results }), {
      headers: {
        ...corsHeaders(requestOrigin),
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error in classify-queries:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders(requestOrigin),
          "Content-Type": "application/json",
        },
      },
    );
  }
});
