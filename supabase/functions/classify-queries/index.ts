import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClassifyRequest {
  queries: string[];
  brandedTerms: string[];
  productTerms: string[];
}

interface ClassificationResult {
  query: string;
  category: 'branded' | 'informational' | 'news' | 'product' | 'commercial' | 'transactional' | 'other';
  entities?: { type: string; name: string }[];
  productMatch?: string;
}

// Pattern-based classification for non-AI fallback
const INFORMATIONAL_PATTERNS = [
  'what is', 'what are', 'how to', 'how do', 'why', 'when', 'where',
  'guide', 'tutorial', 'explained', 'meaning', 'definition', 'examples',
  'difference between', 'vs', 'compare', 'which is better',
  'tips', 'ideas', 'ways to', 'steps to', 'learn', 'understand'
];

const COMMERCIAL_PATTERNS = [
  'best', 'top', 'review', 'reviews', 'comparison', 'alternatives',
  'versus', 'pros and cons', 'worth it', 'ranking',
  'rated', 'recommended', 'should i', 'which'
];

const TRANSACTIONAL_PATTERNS = [
  'buy', 'purchase', 'order', 'price', 'cost', 'cheap', 'deal', 'deals',
  'discount', 'sale', 'subscribe', 'subscription', 'download', 'install',
  'get', 'shop', 'store', 'free', 'trial', 'coupon', 'promo'
];

function classifyWithPatterns(
  query: string, 
  brandedTerms: string[],
  productTerms: string[]
): ClassificationResult['category'] {
  const normalized = query.toLowerCase().trim();
  
  // Branded
  for (const term of brandedTerms) {
    if (normalized.includes(term.toLowerCase())) {
      return 'branded';
    }
  }
  
  // Product
  for (const term of productTerms) {
    if (normalized.includes(term.toLowerCase())) {
      return 'product';
    }
  }
  
  // Transactional
  for (const pattern of TRANSACTIONAL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'transactional';
    }
  }
  
  // Commercial
  for (const pattern of COMMERCIAL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'commercial';
    }
  }
  
  // Informational
  for (const pattern of INFORMATIONAL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'informational';
    }
  }
  
  return 'other';
}

async function classifyWithOpenAI(
  queries: string[],
  brandedTerms: string[],
  productTerms: string[]
): Promise<ClassificationResult[]> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  
  if (!OPENAI_API_KEY) {
    console.log('No OpenAI API key, falling back to pattern matching');
    return queries.map(query => ({
      query,
      category: classifyWithPatterns(query, brandedTerms, productTerms)
    }));
  }
  
  const systemPrompt = `You are a search query classifier. Classify each query into one of these categories:
- branded: Contains brand terms (${brandedTerms.join(', ')})
- informational: Seeking information (how, what, why, guide, etc.)
- news: Current events, news stories, or named entities (people, organizations, countries in news context)
- product: Specific product names or categories from retail taxonomy
- commercial: Research intent (best, reviews, compare, alternatives)
- transactional: Purchase intent (buy, price, deals, order)
- other: Doesn't fit other categories

For each query, also extract named entities (PERSON, ORGANIZATION, LOCATION, EVENT) if present.

Product terms to match: ${productTerms.slice(0, 100).join(', ')}${productTerms.length > 100 ? '...' : ''}

Respond with a JSON array. Example:
[
  {
    "query": "trump news today",
    "category": "news",
    "entities": [{"type": "PERSON", "name": "Trump"}]
  },
  {
    "query": "best laptop 2024",
    "category": "commercial",
    "entities": []
  }
]`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Classify these queries:\n${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content);
    const results = parsed.results || parsed.classifications || parsed;
    
    if (!Array.isArray(results)) {
      // Handle case where response is an object with query keys
      return queries.map(query => {
        const match = results[query] || classifyWithPatterns(query, brandedTerms, productTerms);
        return {
          query,
          category: typeof match === 'string' ? match : match?.category || 'other',
          entities: match?.entities || []
        };
      });
    }
    
    return results.map((r: any, i: number) => ({
      query: r.query || queries[i],
      category: r.category || 'other',
      entities: r.entities || []
    }));
  } catch (error) {
    console.error('OpenAI classification error:', error);
    // Fallback to pattern matching
    return queries.map(query => ({
      query,
      category: classifyWithPatterns(query, brandedTerms, productTerms)
    }));
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { queries, brandedTerms, productTerms }: ClassifyRequest = await req.json();
    
    if (!queries || !Array.isArray(queries)) {
      return new Response(
        JSON.stringify({ error: 'queries must be an array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process in batches of 50 to avoid token limits
    const BATCH_SIZE = 50;
    const results: ClassificationResult[] = [];
    
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);
      const batchResults = await classifyWithOpenAI(batch, brandedTerms || [], productTerms || []);
      results.push(...batchResults);
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in classify-queries:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
