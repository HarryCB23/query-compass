import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { loadProductTaxonomy, COMMON_PRODUCT_TERMS } from '@/lib/productTaxonomy';
import type { QueryCategory } from '@/types/query';

interface Entity {
  type: 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'EVENT';
  name: string;
}

interface ClassificationResult {
  query: string;
  category: QueryCategory;
  entities?: Entity[];
}

interface UseQueryClassificationReturn {
  classifyQueries: (
    queries: string[],
    brandedTerms: string[],
    useAI?: boolean
  ) => Promise<Map<string, ClassificationResult>>;
  isClassifying: boolean;
  progress: number;
  error: string | null;
}

// Pattern-based classification
const INFORMATIONAL_PATTERNS = [
  'what is', 'what are', 'how to', 'how do', 'why', 'when', 'where',
  'guide', 'tutorial', 'explained', 'meaning', 'definition', 'examples',
  'difference between', 'which is better',
  'tips', 'ideas', 'ways to', 'steps to', 'learn', 'understand'
];

const COMMERCIAL_PATTERNS = [
  'best', 'top', 'review', 'reviews', 'comparison', 'alternatives',
  'vs', 'versus', 'compare', 'pros and cons', 'worth it', 'ranking',
  'rated', 'recommended', 'should i', 'which'
];

const TRANSACTIONAL_PATTERNS = [
  'buy', 'purchase', 'order', 'price', 'cost', 'cheap', 'deal', 'deals',
  'discount', 'sale', 'subscribe', 'subscription', 'download', 'install',
  'get', 'shop', 'store', 'free', 'trial', 'coupon', 'promo'
];

// News entity patterns - places, people, organizations, events in news context
const NEWS_PATTERNS = [
  // Keywords
  'news', 'latest', 'breaking', 'update', 'updates', 'today', 'live', 'headlines',
  'budget', 'election', 'vote', 'poll', 'government', 'parliament',
  
  // Political figures - UK
  'keir starmer', 'starmer', 'rachel reeves', 'reeves', 'robert jenrick', 'jenrick',
  'rishi sunak', 'sunak', 'nigel farage', 'farage', 'angela rayner', 'rayner',
  'david lammy', 'lammy', 'shabana mahmood', 'david cameron', 'justin trudeau',
  
  // Political figures - International  
  'trump', 'donald trump', 'biden', 'putin', 'vladimir putin', 'zelensky', 
  'maduro', 'xi jinping', 'macron',
  
  // Countries/places in news context
  'greenland', 'ukraine', 'russia', 'china', 'venezuela', 'israel', 'gaza', 'syria',
  'yemen', 'taiwan', 'north korea', 'islamic republic', 'iran', 'nigeria', 'jamaica',
  'albania', 'pokrovsk', 'belgorod', 'heathrow', 'huntingdon', 'llandudno',
  
  // Organizations & Institutions
  'hmrc', 'nhs', 'ftse', 'ftse 100', 'nato', 'reform uk', 'home office',
  'bbc', 'ryanair', 'asda', 'octopus energy', 'air india',
  
  // Football clubs & sports teams
  'arsenal', 'chelsea', 'liverpool', 'liverpool fc', 'manchester united', 'man utd',
  'tottenham', 'aston villa', 'nottingham forest', 'newcastle united', 'leeds united',
  'england rugby', 'england cricket',
  
  // Sports personalities
  'luke littler', 'adam peaty', 'laila cunningham', 'anthony joshua',
  'ruben amorim', 'amorim', 'maresca',
  
  // Public figures - Entertainment & Media
  'david walliams', 'kevin spacey', 'lily allen', 'meghan markle', 'brooklyn beckham',
  'strictly come dancing', 'strictly', 'traitors', 'the traitors', 'celebrity traitors',
  'i\'m a celeb', 'i\'m a celebrity', 'sports personality',
  
  // Royal family
  'prince andrew', 'andrew mountbatten', 'prince harry', 'prince william',
  'meghan', 'duchess of sussex', 'princess beatrice', 'princess of wales',
  'sarah ferguson', 'royal family', 'royal news', 'royal lodge',
  
  // News topics & Events
  'war', 'invasion', 'conflict', 'crisis', 'attack', 'military', 'army',
  'president', 'minister', 'hurricane', 'storm',
  'immigration', 'asylum', 'asylum seeker', 'asylum seekers', 'deportation', 'migrant',
  'pension', 'state pension', 'retirement', 'tax', 'taxpayers', 'interest rate', 'inheritance',
  'eviction', 'mansion tax', 'death tax',
  'cancer', 'prostate cancer', 'microplastics',
  'epstein', 'epstein files', 'virginia giuffre',
  'darts', 'ashes', 'f1', 'boxing', 'rugby',
  'childbirth', 'weather', 'veterans', 'nurse', 'dehumidifier',
  
  // Specific newsworthy names from data
  'naveed akram', 'fiona hill', 'renee nicole good', 'don daniels',
  'alan perkins', 'dorian puka', 'ryan mendelson'
];

function classifyWithPatterns(
  query: string,
  brandedTerms: string[],
  productTerms: string[]
): QueryCategory {
  const normalized = query.toLowerCase().trim();
  
  // 1. Branded (highest priority)
  for (const term of brandedTerms) {
    if (normalized.includes(term.toLowerCase())) {
      return 'branded';
    }
  }
  
  // 2. News patterns (check early - news queries are high priority)
  for (const pattern of NEWS_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'news';
    }
  }
  
  // 3. Product (check taxonomy)
  for (const term of productTerms) {
    if (normalized.includes(term.toLowerCase())) {
      return 'product';
    }
  }
  
  // 4. Transactional
  for (const pattern of TRANSACTIONAL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'transactional';
    }
  }
  
  // 5. Commercial
  for (const pattern of COMMERCIAL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'commercial';
    }
  }
  
  // 6. Informational
  for (const pattern of INFORMATIONAL_PATTERNS) {
    if (normalized.includes(pattern)) {
      return 'informational';
    }
  }
  
  // Default - will be checked for news entities via AI
  return 'other';
}

export function useQueryClassification(): UseQueryClassificationReturn {
  const [isClassifying, setIsClassifying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const classifyQueries = useCallback(async (
    queries: string[],
    brandedTerms: string[],
    useAI: boolean = true
  ): Promise<Map<string, ClassificationResult>> => {
    setIsClassifying(true);
    setProgress(0);
    setError(null);
    
    const results = new Map<string, ClassificationResult>();
    
    try {
      // Load product taxonomy
      const productTerms = await loadProductTaxonomy();
      const allProductTerms = [...COMMON_PRODUCT_TERMS, ...productTerms.slice(0, 500)];
      
      setProgress(10);
      
      // Step 1: Pattern-based classification for all queries
      const needsNER: string[] = [];
      
      queries.forEach(query => {
        const category = classifyWithPatterns(query, brandedTerms, allProductTerms);
        results.set(query, { query, category });
        
        // If classified as 'other', it might be a news entity
        if (category === 'other') {
          needsNER.push(query);
        }
      });
      
      setProgress(30);
      
      // Step 2: Use OpenAI NER only for 'other' queries to detect news entities
      // Process in parallel batches for better performance
      if (useAI && needsNER.length > 0) {
        const BATCH_SIZE = 100; // Increased batch size
        const PARALLEL_BATCHES = 5; // Process 5 batches concurrently
        const batches: string[][] = [];
        
        for (let i = 0; i < needsNER.length; i += BATCH_SIZE) {
          batches.push(needsNER.slice(i, i + BATCH_SIZE));
        }
        
        let completed = 0;
        
        // Process batches in parallel groups
        for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
          const parallelGroup = batches.slice(i, i + PARALLEL_BATCHES);
          
          const batchPromises = parallelGroup.map(async (batch) => {
            try {
              const { data, error: fnError } = await supabase.functions.invoke('classify-queries', {
                body: { queries: batch }
              });
              
              if (fnError) {
                console.error('NER error:', fnError);
                return;
              }
              
              if (data?.results) {
                data.results.forEach((r: { query: string; entities: Entity[]; isNewsEntity: boolean }) => {
                  if (r.isNewsEntity && r.entities.length > 0) {
                    results.set(r.query, {
                      query: r.query,
                      category: 'news',
                      entities: r.entities
                    });
                  }
                });
              }
            } catch (err) {
              console.error('NER batch error:', err);
            }
          });
          
          await Promise.all(batchPromises);
          completed += parallelGroup.length;
          setProgress(30 + Math.round((completed / batches.length) * 60));
        }
      }
      
      setProgress(100);
      return results;
    } catch (err) {
      console.error('Classification error:', err);
      setError(err instanceof Error ? err.message : 'Classification failed');
      return results;
    } finally {
      setIsClassifying(false);
    }
  }, []);

  return { classifyQueries, isClassifying, progress, error };
}
