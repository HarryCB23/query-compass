import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { loadProductTaxonomy, COMMON_PRODUCT_TERMS } from '@/lib/productTaxonomy';
import { classifyQuery as classifyQueryLocal } from '@/lib/queryClassifier';
import type { QueryCategory } from '@/types/query';

interface ClassificationResult {
  query: string;
  category: QueryCategory;
  entities?: { type: string; name: string }[];
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
      
      if (useAI) {
        // Use AI classification via edge function
        const BATCH_SIZE = 100;
        const batches = Math.ceil(queries.length / BATCH_SIZE);
        
        for (let i = 0; i < batches; i++) {
          const batch = queries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
          
          const { data, error: fnError } = await supabase.functions.invoke('classify-queries', {
            body: {
              queries: batch,
              brandedTerms,
              productTerms: allProductTerms
            }
          });
          
          if (fnError) {
            console.error('Classification error:', fnError);
            // Fallback to local classification for this batch
            batch.forEach(query => {
              results.set(query, {
                query,
                category: classifyQueryLocal(query, { brandedTerms, productTerms: allProductTerms })
              });
            });
          } else if (data?.results) {
            data.results.forEach((r: ClassificationResult) => {
              results.set(r.query, r);
            });
          }
          
          setProgress(Math.round(((i + 1) / batches) * 100));
        }
      } else {
        // Local pattern-based classification
        queries.forEach((query, index) => {
          results.set(query, {
            query,
            category: classifyQueryLocal(query, { brandedTerms, productTerms: allProductTerms })
          });
          
          if (index % 100 === 0) {
            setProgress(Math.round((index / queries.length) * 100));
          }
        });
      }
      
      setProgress(100);
      return results;
    } catch (err) {
      console.error('Classification error:', err);
      setError(err instanceof Error ? err.message : 'Classification failed');
      
      // Return local classifications as fallback
      queries.forEach(query => {
        results.set(query, {
          query,
          category: classifyQueryLocal(query, { brandedTerms })
        });
      });
      
      return results;
    } finally {
      setIsClassifying(false);
    }
  }, []);

  return { classifyQueries, isClassifying, progress, error };
}
