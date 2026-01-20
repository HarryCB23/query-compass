import type { QueryCategory, ClassificationConfig } from '@/types/query';

const DEFAULT_CONFIG: ClassificationConfig = {
  brandedTerms: ['telegraph', 'the telegraph'],
  informationalPatterns: [
    'what is', 'what are', 'how to', 'how do', 'why', 'when', 'where',
    'guide', 'tutorial', 'explained', 'meaning', 'definition', 'examples',
    'difference between', 'vs', 'compare', 'which is better',
    'tips', 'ideas', 'ways to', 'steps to', 'learn', 'understand'
  ],
  commercialPatterns: [
    'best', 'top', 'review', 'reviews', 'comparison', 'alternatives',
    'vs', 'versus', 'compare', 'pros and cons', 'worth it', 'ranking',
    'rated', 'recommended', 'should i', 'which'
  ],
  transactionalPatterns: [
    'buy', 'purchase', 'order', 'price', 'cost', 'cheap', 'deal', 'deals',
    'discount', 'sale', 'subscribe', 'subscription', 'download', 'install',
    'get', 'shop', 'store', 'free', 'trial', 'coupon', 'promo'
  ],
  productTerms: [] // Can be populated with specific product names
};

// News entities - typically proper nouns, people, places, organizations
// These are common news-related terms that indicate entity/news queries
const NEWS_ENTITY_PATTERNS = [
  // Political figures
  'trump', 'biden', 'putin', 'zelensky', 'maduro', 'xi jinping', 'macron', 'sunak',
  // Countries in news context
  'iran', 'ukraine', 'russia', 'china', 'venezuela', 'israel', 'gaza', 'syria',
  'yemen', 'taiwan', 'greenland', 'north korea',
  // News-related suffixes
  'news', 'latest', 'update', 'updates', 'breaking', 'today', 'live',
  // War/conflict terms
  'war', 'invasion', 'conflict', 'crisis', 'attack', 'military',
  // Generic news indicators
  'president', 'minister', 'election', 'vote', 'poll', 'government'
];

export function classifyQuery(
  query: string, 
  config: Partial<ClassificationConfig> = {}
): QueryCategory {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const normalizedQuery = query.toLowerCase().trim();
  
  // Check branded first (highest priority)
  for (const term of mergedConfig.brandedTerms) {
    if (normalizedQuery.includes(term.toLowerCase())) {
      return 'branded';
    }
  }
  
  // Check for product terms
  for (const term of mergedConfig.productTerms) {
    if (normalizedQuery.includes(term.toLowerCase())) {
      return 'product';
    }
  }
  
  // Check transactional patterns
  for (const pattern of mergedConfig.transactionalPatterns) {
    if (normalizedQuery.includes(pattern.toLowerCase())) {
      return 'transactional';
    }
  }
  
  // Check commercial patterns
  for (const pattern of mergedConfig.commercialPatterns) {
    if (normalizedQuery.includes(pattern.toLowerCase())) {
      return 'commercial';
    }
  }
  
  // Check informational patterns
  for (const pattern of mergedConfig.informationalPatterns) {
    if (normalizedQuery.includes(pattern.toLowerCase())) {
      return 'informational';
    }
  }
  
  // Check news entity patterns
  for (const pattern of NEWS_ENTITY_PATTERNS) {
    if (normalizedQuery.includes(pattern.toLowerCase())) {
      return 'news';
    }
  }
  
  // Default to other
  return 'other';
}

export function parseCSV(csvText: string): { headers: string[], rows: string[][] } {
  const lines = csvText.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => parseCSVLine(line));
  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

export function parsePercentage(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace('%', '').trim();
  return parseFloat(cleaned) || 0;
}

export function parseNumber(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/,/g, '').trim();
  return parseFloat(cleaned) || 0;
}
