import type { QueryData } from '@/types/query';

// Core entities to look for - these will be clustered
// e.g., "iran", "iran news", "iran latest" all become "iran"
const CORE_ENTITIES = [
  // Countries
  'iran', 'russia', 'ukraine', 'china', 'israel', 'gaza', 'syria', 'yemen', 
  'greenland', 'taiwan', 'venezuela', 'north korea', 'nigeria', 'albania',
  
  // Political figures - International
  'trump', 'putin', 'biden', 'zelensky', 'maduro', 'xi jinping', 'macron',
  
  // Political figures - UK
  'starmer', 'reeves', 'farage', 'sunak', 'jenrick', 'rayner', 'lammy',
  
  // Royal family
  'prince andrew', 'prince harry', 'prince william', 'meghan', 'royal family',
  'princess beatrice', 'princess of wales', 'sarah ferguson',
  
  // Sports personalities
  'luke littler', 'adam peaty', 'anthony joshua', 'amorim', 'maresca',
  
  // Celebrities
  'kevin spacey', 'lily allen', 'david walliams', 'brooklyn beckham',
  
  // Organizations
  'hmrc', 'nhs', 'nato', 'reform uk', 'ryanair', 'asda', 'bbc',
  
  // Football clubs
  'arsenal', 'chelsea', 'liverpool', 'manchester united', 'tottenham',
  'aston villa', 'nottingham forest', 'newcastle united', 'leeds united',
  
  // TV Shows
  'strictly', 'traitors', 'i\'m a celebrity',
  
  // Topics
  'pension', 'budget', 'election', 'immigration', 'epstein', 'darts', 'ashes',
  'f1', 'boxing', 'rugby', 'weather', 'cancer'
];

export interface EntityStats {
  entity: string;
  queryCount: number;
  totalClicksCurrent: number;
  totalClicksPrevious: number;
  totalImpressionsCurrent: number;
  totalImpressionsPrevious: number;
  clicksChange: number;
  clicksChangePercent: number;
  queries: QueryData[];
}

/**
 * Extract the core entity from a query
 * e.g., "iran news" -> "iran", "iran latest update" -> "iran"
 */
function extractCoreEntity(query: string): string | null {
  const normalized = query.toLowerCase().trim();
  
  // Check each core entity - return the first match
  // Sort by length descending to match longer entities first (e.g., "prince andrew" before "andrew")
  const sortedEntities = [...CORE_ENTITIES].sort((a, b) => b.length - a.length);
  
  for (const entity of sortedEntities) {
    if (normalized.includes(entity)) {
      return entity;
    }
  }
  
  return null;
}

/**
 * Extract entities from news queries and aggregate their stats
 */
export function extractEntityStats(queries: QueryData[]): EntityStats[] {
  const entityMap = new Map<string, EntityStats>();
  
  // Only process news queries
  const newsQueries = queries.filter(q => q.category === 'news');
  
  for (const query of newsQueries) {
    const entity = extractCoreEntity(query.query);
    
    if (!entity) continue;
    
    const existing = entityMap.get(entity);
    
    if (existing) {
      existing.queryCount++;
      existing.totalClicksCurrent += query.clicksCurrent;
      existing.totalClicksPrevious += query.clicksPrevious;
      existing.totalImpressionsCurrent += query.impressionsCurrent;
      existing.totalImpressionsPrevious += query.impressionsPrevious;
      existing.queries.push(query);
    } else {
      entityMap.set(entity, {
        entity,
        queryCount: 1,
        totalClicksCurrent: query.clicksCurrent,
        totalClicksPrevious: query.clicksPrevious,
        totalImpressionsCurrent: query.impressionsCurrent,
        totalImpressionsPrevious: query.impressionsPrevious,
        clicksChange: 0,
        clicksChangePercent: 0,
        queries: [query]
      });
    }
  }
  
  // Calculate change percentages
  for (const stats of entityMap.values()) {
    stats.clicksChange = stats.totalClicksCurrent - stats.totalClicksPrevious;
    stats.clicksChangePercent = stats.totalClicksPrevious > 0
      ? ((stats.totalClicksCurrent - stats.totalClicksPrevious) / stats.totalClicksPrevious) * 100
      : stats.totalClicksCurrent > 0 ? 100 : 0;
  }
  
  // Sort by total clicks (current) descending
  return Array.from(entityMap.values()).sort((a, b) => b.totalClicksCurrent - a.totalClicksCurrent);
}

/**
 * Get queries containing a specific entity
 */
export function getQueriesForEntity(queries: QueryData[], entity: string): QueryData[] {
  const normalized = entity.toLowerCase();
  return queries.filter(q => 
    q.category === 'news' && 
    q.query.toLowerCase().includes(normalized)
  );
}
