import { useState, useMemo, useCallback } from 'react';
import { Search, BarChart3, TrendingUp, MousePointer, Eye, Loader2, Sparkles, Download, Target, Percent, Users, Filter } from 'lucide-react';
import { FileUpload } from '@/components/FileUpload';
import { BrandedTermsInput } from '@/components/BrandedTermsInput';
import { StatCard } from '@/components/StatCard';
import { CategoryDistributionChart } from '@/components/CategoryDistributionChart';
import { CategoryChangeChart } from '@/components/CategoryChangeChart';
import { CategoryMetricCards } from '@/components/CategoryMetricCards';
import { CategoryMetricsPanel } from '@/components/CategoryMetricsPanel';
import { QueryTable } from '@/components/QueryTable';
import { CategoryFilter } from '@/components/CategoryFilter';
import { EntityExplorer } from '@/components/EntityExplorer';
import { TopShiftingQueries } from '@/components/TopShiftingQueries';
import { SectionHeader } from '@/components/SectionHeader';
import { parseCSV, parseNumber, parsePercentage, classifyQuery } from '@/lib/queryClassifier';
import { useQueryClassification } from '@/hooks/useQueryClassification';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import type { QueryData, CategoryStats, QueryCategory } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';
import { toast } from 'sonner';

export default function Index() {
  const [brandedTerms, setBrandedTerms] = useState<string[]>(['telegraph', 'the telegraph']);
  const [queryData, setQueryData] = useState<QueryData[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<QueryCategory | 'all'>('all');
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [useAIClassification, setUseAIClassification] = useState(true);
  
  const { classifyQueries, isClassifying, progress, error } = useQueryClassification();

  const handleFileLoaded = useCallback(async (content: string, name: string) => {
    const { rows } = parseCSV(content);
    
    const parsedRows = rows
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
          category: 'other' as QueryCategory, // Will be classified
          clicksChange,
          clicksChangePercent,
          impressionsChange,
          impressionsChangePercent,
        };
      });
    
    setFileName(name);
    
    // Classify queries
    const queries = parsedRows.map(r => r.query);
    
    if (useAIClassification) {
      toast.info('Classifying queries with AI...', { duration: 2000 });
    }
    
    const classifications = await classifyQueries(queries, brandedTerms, useAIClassification);
    
    const classifiedData = parsedRows.map(row => ({
      ...row,
      category: classifications.get(row.query)?.category || 'other'
    }));
    
    setQueryData(classifiedData);
    
    if (useAIClassification) {
      toast.success(`Classified ${classifiedData.length} queries with AI`);
    }
  }, [brandedTerms, useAIClassification, classifyQueries]);

  // Use the already classified data
  const reclassifiedData = useMemo(() => {
    // Re-check branded terms only (fast local check)
    return queryData.map(q => {
      const isBranded = brandedTerms.some(term => 
        q.query.toLowerCase().includes(term.toLowerCase())
      );
      return {
        ...q,
        category: isBranded ? 'branded' as QueryCategory : q.category,
      };
    });
  }, [queryData, brandedTerms]);

  // Calculate category stats with all metrics
  const categoryStats = useMemo((): CategoryStats[] => {
    const categories: QueryCategory[] = ['branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other'];
    
    return categories.map(category => {
      const categoryQueries = reclassifiedData.filter(q => q.category === category);
      const count = categoryQueries.length;
      
      const totalClicksCurrent = categoryQueries.reduce((sum, q) => sum + q.clicksCurrent, 0);
      const totalClicksPrevious = categoryQueries.reduce((sum, q) => sum + q.clicksPrevious, 0);
      const totalImpressionsCurrent = categoryQueries.reduce((sum, q) => sum + q.impressionsCurrent, 0);
      const totalImpressionsPrevious = categoryQueries.reduce((sum, q) => sum + q.impressionsPrevious, 0);
      
      // Weighted average position (by impressions)
      const weightedPositionCurrent = categoryQueries.reduce((sum, q) => sum + (q.positionCurrent * q.impressionsCurrent), 0);
      const weightedPositionPrevious = categoryQueries.reduce((sum, q) => sum + (q.positionPrevious * q.impressionsPrevious), 0);
      const avgPositionCurrent = totalImpressionsCurrent > 0 ? weightedPositionCurrent / totalImpressionsCurrent : 0;
      const avgPositionPrevious = totalImpressionsPrevious > 0 ? weightedPositionPrevious / totalImpressionsPrevious : 0;
      
      // CTR calculated from totals
      const avgCtrCurrent = totalImpressionsCurrent > 0 ? (totalClicksCurrent / totalImpressionsCurrent) * 100 : 0;
      const avgCtrPrevious = totalImpressionsPrevious > 0 ? (totalClicksPrevious / totalImpressionsPrevious) * 100 : 0;
      
      const clicksChange = totalClicksCurrent - totalClicksPrevious;
      const clicksChangePercent = totalClicksPrevious > 0 
        ? ((totalClicksCurrent - totalClicksPrevious) / totalClicksPrevious) * 100 
        : totalClicksCurrent > 0 ? 100 : 0;
      
      const impressionsChangePercent = totalImpressionsPrevious > 0 
        ? ((totalImpressionsCurrent - totalImpressionsPrevious) / totalImpressionsPrevious) * 100 
        : totalImpressionsCurrent > 0 ? 100 : 0;
      
      const positionChange = avgPositionPrevious > 0 
        ? ((avgPositionCurrent - avgPositionPrevious) / avgPositionPrevious) * 100 
        : 0;
      
      const ctrChange = avgCtrPrevious > 0 
        ? ((avgCtrCurrent - avgCtrPrevious) / avgCtrPrevious) * 100 
        : avgCtrCurrent > 0 ? 100 : 0;
      
      return {
        category,
        totalClicksCurrent,
        totalClicksPrevious,
        totalImpressionsCurrent,
        totalImpressionsPrevious,
        queryCount: count,
        clicksChange,
        clicksChangePercent,
        impressionsChangePercent,
        avgPositionCurrent,
        avgPositionPrevious,
        positionChange,
        avgCtrCurrent,
        avgCtrPrevious,
        ctrChange,
      };
    });
  }, [reclassifiedData]);

  // Overall stats with position and CTR
  const overallStats = useMemo(() => {
    const totalClicksCurrent = reclassifiedData.reduce((sum, q) => sum + q.clicksCurrent, 0);
    const totalClicksPrevious = reclassifiedData.reduce((sum, q) => sum + q.clicksPrevious, 0);
    const totalImpressionsCurrent = reclassifiedData.reduce((sum, q) => sum + q.impressionsCurrent, 0);
    const totalImpressionsPrevious = reclassifiedData.reduce((sum, q) => sum + q.impressionsPrevious, 0);
    
    // Weighted average position
    const weightedPositionCurrent = reclassifiedData.reduce((sum, q) => sum + (q.positionCurrent * q.impressionsCurrent), 0);
    const weightedPositionPrevious = reclassifiedData.reduce((sum, q) => sum + (q.positionPrevious * q.impressionsPrevious), 0);
    const avgPositionCurrent = totalImpressionsCurrent > 0 ? weightedPositionCurrent / totalImpressionsCurrent : 0;
    const avgPositionPrevious = totalImpressionsPrevious > 0 ? weightedPositionPrevious / totalImpressionsPrevious : 0;
    
    // CTR from totals
    const avgCtrCurrent = totalImpressionsCurrent > 0 ? (totalClicksCurrent / totalImpressionsCurrent) * 100 : 0;
    const avgCtrPrevious = totalImpressionsPrevious > 0 ? (totalClicksPrevious / totalImpressionsPrevious) * 100 : 0;
    
    const clicksChange = totalClicksPrevious > 0 
      ? ((totalClicksCurrent - totalClicksPrevious) / totalClicksPrevious) * 100 
      : 0;
    const impressionsChange = totalImpressionsPrevious > 0 
      ? ((totalImpressionsCurrent - totalImpressionsPrevious) / totalImpressionsPrevious) * 100 
      : 0;
    const positionChange = avgPositionPrevious > 0 
      ? ((avgPositionCurrent - avgPositionPrevious) / avgPositionPrevious) * 100 
      : 0;
    const ctrChange = avgCtrPrevious > 0 
      ? ((avgCtrCurrent - avgCtrPrevious) / avgCtrPrevious) * 100 
      : avgCtrCurrent > 0 ? 100 : 0;
    
    return {
      totalClicksCurrent,
      totalClicksPrevious,
      totalImpressionsCurrent,
      totalImpressionsPrevious,
      clicksChange,
      impressionsChange,
      queryCount: reclassifiedData.length,
      avgPositionCurrent,
      avgPositionPrevious,
      positionChange,
      avgCtrCurrent,
      avgCtrPrevious,
      ctrChange,
    };
  }, [reclassifiedData]);

  // Get selected category stats
  const selectedCategoryStats = useMemo(() => {
    if (categoryFilter === 'all') return null;
    return categoryStats.find(s => s.category === categoryFilter) || null;
  }, [categoryFilter, categoryStats]);

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

  // CSV Download function
  const handleDownloadCSV = useCallback(() => {
    const headers = ['Query', 'Category', 'Clicks (Current)', 'Clicks (Previous)', 'Clicks Change', 'Clicks Change %', 'Impressions (Current)', 'Impressions (Previous)', 'Impressions Change', 'Impressions Change %', 'CTR (Current)', 'CTR (Previous)', 'Position (Current)', 'Position (Previous)'];
    
    const rows = reclassifiedData.map(row => [
      `"${row.query.replace(/"/g, '""')}"`,
      row.category,
      row.clicksCurrent,
      row.clicksPrevious,
      row.clicksChange,
      row.clicksChangePercent.toFixed(2),
      row.impressionsCurrent,
      row.impressionsPrevious,
      row.impressionsChange,
      row.impressionsChangePercent.toFixed(2),
      row.ctrCurrent.toFixed(2),
      row.ctrPrevious.toFixed(2),
      row.positionCurrent.toFixed(2),
      row.positionPrevious.toFixed(2)
    ].join(','));
    
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `classified-queries-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success('CSV downloaded successfully');
  }, [reclassifiedData]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container py-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <Search className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                GSC Query Shift Analyzer
              </h1>
              <p className="text-sm text-muted-foreground">
                Analyze search query changes and classify by intent
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
        {isClassifying && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-card border rounded-xl p-8 max-w-md w-full mx-4 space-y-4 shadow-lg">
              <div className="flex items-center gap-3">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                <h3 className="font-semibold text-foreground">Classifying queries with AI...</h3>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground">
                Using OpenAI for NER and product taxonomy matching
              </p>
            </div>
          </div>
        )}
        
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
            
            {/* AI Classification Toggle */}
            <div className="p-6 bg-card border rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <div>
                    <Label htmlFor="ai-toggle" className="font-medium">AI Classification</Label>
                    <p className="text-sm text-muted-foreground">
                      Use OpenAI for NER and product taxonomy matching
                    </p>
                  </div>
                </div>
                <Switch
                  id="ai-toggle"
                  checked={useAIClassification}
                  onCheckedChange={setUseAIClassification}
                />
              </div>
            </div>
            
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
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 glass-card">
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
              <Button onClick={handleDownloadCSV} variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                Download CSV
              </Button>
            </div>

            {/* Stats Grid - 4 key metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

            {/* Charts Row 1: Clicks */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 glass-card">
                <SectionHeader 
                  icon={<BarChart3 className="w-4 h-4" />}
                  title="Clicks by Category"
                />
                <CategoryDistributionChart stats={categoryStats} dataKey="clicks" />
              </div>
              
              <div className="p-6 glass-card">
                <SectionHeader 
                  icon={<TrendingUp className="w-4 h-4" />}
                  title="Category Change (% Clicks)"
                />
                <CategoryChangeChart stats={categoryStats} />
              </div>
            </div>

            {/* Row 2: Position & CTR Metric Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-6 glass-card">
                <SectionHeader 
                  icon={<Target className="w-4 h-4" />}
                  title="Average Position by Category"
                  subtitle="(lower is better)"
                />
                <CategoryMetricCards stats={categoryStats} metric="position" />
              </div>
              
              <div className="p-6 glass-card">
                <SectionHeader 
                  icon={<Percent className="w-4 h-4" />}
                  title="CTR by Category"
                />
                <CategoryMetricCards stats={categoryStats} metric="ctr" />
              </div>
            </div>

            {/* Entity Explorer - News Entities */}
            <div className="p-6 glass-card">
              <SectionHeader 
                icon={<Users className="w-4 h-4" />}
                title="News Entity Explorer"
                subtitle="Click an entity to see performance"
              />
              <EntityExplorer 
                queries={reclassifiedData}
                onEntitySelect={(entity, queries) => {
                  setEntityFilter(entity);
                  setCategoryFilter('news');
                  toast.success(`Filtered to "${entity}" - ${queries.length} queries`);
                }}
              />
            </div>

            {/* Category Filter */}
            <div className="p-6 glass-card">
              <SectionHeader 
                icon={<Filter className="w-4 h-4" />}
                title="Filter by Category"
                subtitle={entityFilter ? `Filtered: "${entityFilter}"` : undefined}
              />
              {entityFilter && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setEntityFilter(null)}
                  className="text-xs mb-4"
                >
                  Clear entity filter
                </Button>
              )}
              <CategoryFilter 
                selected={categoryFilter} 
                onChange={(cat) => {
                  setCategoryFilter(cat);
                  if (cat !== 'news') setEntityFilter(null);
                }}
                counts={categoryCounts}
              />
            </div>

            {/* Category Metrics Panel + Top Shifting Queries - shows when category selected */}
            {selectedCategoryStats && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryMetricsPanel stats={selectedCategoryStats} />
                
                <div className="p-6 glass-card">
                  <SectionHeader 
                    icon={<TrendingUp className="w-4 h-4" />}
                    title="Top 20 Shifting Queries"
                    subtitle="by absolute click change"
                  />
                  <div className="max-h-80 overflow-y-auto">
                    <TopShiftingQueries 
                      queries={reclassifiedData} 
                      category={categoryFilter as QueryCategory}
                      limit={20}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Query Table */}
            <div className="p-6 glass-card">
              <SectionHeader 
                icon={<Search className="w-4 h-4" />}
                title="Query Details"
                subtitle={entityFilter ? `Filtered by "${entityFilter}"` : undefined}
              />
              <QueryTable 
                data={entityFilter 
                  ? reclassifiedData.filter(q => 
                      q.query.toLowerCase().includes(entityFilter.toLowerCase())
                    )
                  : reclassifiedData
                }
                categoryFilter={categoryFilter}
                onCategoryFilterChange={setCategoryFilter}
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-card/50 mt-auto">
        <div className="container py-4 text-center text-xs text-muted-foreground tracking-wide">
          GSC Query Shift Analyzer • Analyze your search performance changes
        </div>
      </footer>
    </div>
  );
}
