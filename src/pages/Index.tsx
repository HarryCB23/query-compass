import { useState, useMemo, useCallback } from 'react';
import { Search, BarChart3, TrendingUp, MousePointer, Eye } from 'lucide-react';
import { FileUpload } from '@/components/FileUpload';
import { BrandedTermsInput } from '@/components/BrandedTermsInput';
import { StatCard } from '@/components/StatCard';
import { CategoryDistributionChart } from '@/components/CategoryDistributionChart';
import { CategoryChangeChart } from '@/components/CategoryChangeChart';
import { QueryTable } from '@/components/QueryTable';
import { CategoryFilter } from '@/components/CategoryFilter';
import { classifyQuery, parseCSV, parseNumber, parsePercentage } from '@/lib/queryClassifier';
import type { QueryData, CategoryStats, QueryCategory } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';

export default function Index() {
  const [brandedTerms, setBrandedTerms] = useState<string[]>(['telegraph', 'the telegraph']);
  const [queryData, setQueryData] = useState<QueryData[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<QueryCategory | 'all'>('all');

  const handleFileLoaded = useCallback((content: string, name: string) => {
    const { rows } = parseCSV(content);
    
    const parsed: QueryData[] = rows
      .filter(row => row[0] && row[0].trim())
      .map(row => {
        const query = row[0];
        const clicksCurrent = parseNumber(row[1]);
        const clicksPrevious = parseNumber(row[2]);
        const impressionsCurrent = parseNumber(row[3]);
        const impressionsPrevious = parseNumber(row[4]);
        const ctrCurrent = parsePercentage(row[5]);
        const ctrPrevious = parsePercentage(row[6]);
        const positionCurrent = parseNumber(row[7]);
        const positionPrevious = parseNumber(row[8]);
        
        const clicksChange = clicksCurrent - clicksPrevious;
        const clicksChangePercent = clicksPrevious > 0 
          ? ((clicksCurrent - clicksPrevious) / clicksPrevious) * 100 
          : clicksCurrent > 0 ? 100 : 0;
        
        const impressionsChange = impressionsCurrent - impressionsPrevious;
        const impressionsChangePercent = impressionsPrevious > 0 
          ? ((impressionsCurrent - impressionsPrevious) / impressionsPrevious) * 100 
          : impressionsCurrent > 0 ? 100 : 0;
        
        return {
          query,
          clicksCurrent,
          clicksPrevious,
          impressionsCurrent,
          impressionsPrevious,
          ctrCurrent,
          ctrPrevious,
          positionCurrent,
          positionPrevious,
          category: classifyQuery(query, { brandedTerms }),
          clicksChange,
          clicksChangePercent,
          impressionsChange,
          impressionsChangePercent,
        };
      });
    
    setQueryData(parsed);
    setFileName(name);
  }, [brandedTerms]);

  // Reclassify when branded terms change
  const reclassifiedData = useMemo(() => {
    return queryData.map(q => ({
      ...q,
      category: classifyQuery(q.query, { brandedTerms }),
    }));
  }, [queryData, brandedTerms]);

  // Calculate category stats
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: QueryCategory[] = ['branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other'];
    
    return categories.map(category => {
      const categoryQueries = reclassifiedData.filter(q => q.category === category);
      const totalClicksCurrent = categoryQueries.reduce((sum, q) => sum + q.clicksCurrent, 0);
      const totalClicksPrevious = categoryQueries.reduce((sum, q) => sum + q.clicksPrevious, 0);
      const totalImpressionsCurrent = categoryQueries.reduce((sum, q) => sum + q.impressionsCurrent, 0);
      const totalImpressionsPrevious = categoryQueries.reduce((sum, q) => sum + q.impressionsPrevious, 0);
      
      const clicksChange = totalClicksCurrent - totalClicksPrevious;
      const clicksChangePercent = totalClicksPrevious > 0 
        ? ((totalClicksCurrent - totalClicksPrevious) / totalClicksPrevious) * 100 
        : totalClicksCurrent > 0 ? 100 : 0;
      
      return {
        category,
        totalClicksCurrent,
        totalClicksPrevious,
        totalImpressionsCurrent,
        totalImpressionsPrevious,
        queryCount: categoryQueries.length,
        clicksChange,
        clicksChangePercent,
      };
    });
  }, [reclassifiedData]);

  // Overall stats
  const overallStats = useMemo(() => {
    const totalClicksCurrent = reclassifiedData.reduce((sum, q) => sum + q.clicksCurrent, 0);
    const totalClicksPrevious = reclassifiedData.reduce((sum, q) => sum + q.clicksPrevious, 0);
    const totalImpressionsCurrent = reclassifiedData.reduce((sum, q) => sum + q.impressionsCurrent, 0);
    const totalImpressionsPrevious = reclassifiedData.reduce((sum, q) => sum + q.impressionsPrevious, 0);
    
    const clicksChange = totalClicksPrevious > 0 
      ? ((totalClicksCurrent - totalClicksPrevious) / totalClicksPrevious) * 100 
      : 0;
    const impressionsChange = totalImpressionsPrevious > 0 
      ? ((totalImpressionsCurrent - totalImpressionsPrevious) / totalImpressionsPrevious) * 100 
      : 0;
    
    return {
      totalClicksCurrent,
      totalClicksPrevious,
      totalImpressionsCurrent,
      totalImpressionsPrevious,
      clicksChange,
      impressionsChange,
      queryCount: reclassifiedData.length,
    };
  }, [reclassifiedData]);

  // Category counts for filter
  const categoryCounts = useMemo(() => {
    const counts: Record<QueryCategory | 'all', number> = {
      all: reclassifiedData.length,
      branded: 0,
      informational: 0,
      news: 0,
      product: 0,
      commercial: 0,
      transactional: 0,
      other: 0,
    };
    
    reclassifiedData.forEach(q => {
      counts[q.category]++;
    });
    
    return counts;
  }, [reclassifiedData]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Search className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                GSC Query Shift Analyzer
              </h1>
              <p className="text-muted-foreground">
                Analyze search query changes and classify by intent
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
        {reclassifiedData.length === 0 ? (
          /* Upload State */
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold text-foreground">
                Upload your Search Console data
              </h2>
              <p className="text-muted-foreground">
                Export a CSV from Google Search Console comparing two time periods to analyze query shifts
              </p>
            </div>
            
            <FileUpload onFileLoaded={handleFileLoaded} />
            
            <div className="p-6 bg-card border rounded-xl">
              <BrandedTermsInput 
                terms={brandedTerms} 
                onChange={setBrandedTerms} 
              />
            </div>
            
            <div className="p-6 bg-muted/50 rounded-xl">
              <h3 className="font-medium text-foreground mb-3">Query Categories</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="category-badge category-branded">Branded</span>
                  <span className="text-muted-foreground">Your brand terms</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="category-badge category-informational">Informational</span>
                  <span className="text-muted-foreground">How, what, why queries</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="category-badge category-news">News</span>
                  <span className="text-muted-foreground">Current events, entities</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="category-badge category-product">Product</span>
                  <span className="text-muted-foreground">Specific products</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="category-badge category-commercial">Commercial</span>
                  <span className="text-muted-foreground">Best, reviews, compare</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="category-badge category-transactional">Transactional</span>
                  <span className="text-muted-foreground">Buy, price, deals</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Analysis State */
          <div className="space-y-8 animate-fade-in">
            {/* Config Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-card border rounded-xl">
              <div className="flex items-center gap-4">
                <FileUpload 
                  onFileLoaded={handleFileLoaded} 
                  className="w-auto"
                />
              </div>
              <div className="flex-1 max-w-md">
                <BrandedTermsInput 
                  terms={brandedTerms} 
                  onChange={setBrandedTerms} 
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Queries"
                value={overallStats.queryCount}
                icon={<Search className="w-5 h-5 text-primary" />}
              />
              <StatCard
                title="Total Clicks"
                value={overallStats.totalClicksCurrent}
                change={overallStats.clicksChange}
                icon={<MousePointer className="w-5 h-5 text-primary" />}
              />
              <StatCard
                title="Total Impressions"
                value={overallStats.totalImpressionsCurrent}
                change={overallStats.impressionsChange}
                icon={<Eye className="w-5 h-5 text-primary" />}
              />
              <StatCard
                title="Biggest Shift"
                value={(() => {
                  const sorted = [...categoryStats].sort((a, b) => 
                    Math.abs(b.clicksChangePercent) - Math.abs(a.clicksChangePercent)
                  );
                  return CATEGORY_LABELS[sorted[0]?.category || 'other'];
                })()}
                change={(() => {
                  const sorted = [...categoryStats].sort((a, b) => 
                    Math.abs(b.clicksChangePercent) - Math.abs(a.clicksChangePercent)
                  );
                  return sorted[0]?.clicksChangePercent || 0;
                })()}
                icon={<TrendingUp className="w-5 h-5 text-primary" />}
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 bg-card border rounded-xl">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Clicks by Category
                </h3>
                <CategoryDistributionChart stats={categoryStats} dataKey="clicks" />
              </div>
              
              <div className="p-6 bg-card border rounded-xl">
                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Category Change (% Clicks)
                </h3>
                <CategoryChangeChart stats={categoryStats} />
              </div>
            </div>

            {/* Category Filter */}
            <div className="p-6 bg-card border rounded-xl">
              <h3 className="font-semibold text-foreground mb-4">Filter by Category</h3>
              <CategoryFilter 
                selected={categoryFilter} 
                onChange={setCategoryFilter}
                counts={categoryCounts}
              />
            </div>

            {/* Query Table */}
            <div className="p-6 bg-card border rounded-xl">
              <h3 className="font-semibold text-foreground mb-4">Query Details</h3>
              <QueryTable 
                data={reclassifiedData}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={setCategoryFilter}
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-card mt-auto">
        <div className="container py-4 text-center text-sm text-muted-foreground">
          GSC Query Shift Analyzer • Analyze your search performance changes
        </div>
      </footer>
    </div>
  );
}
