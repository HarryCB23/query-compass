import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from './CategoryBadge';
import type { QueryData, QueryCategory } from '@/types/query';
import { cn } from '@/lib/utils';

interface QueryTableProps {
  data: QueryData[];
  categoryFilter?: QueryCategory | 'all';
  onCategoryFilterChange?: (category: QueryCategory | 'all') => void;
}

type SortKey = 'query' | 'clicksCurrent' | 'clicksChange' | 'impressionsCurrent' | 'impressionsChange' | 'category';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 100;

export function QueryTable({ data, categoryFilter = 'all', onCategoryFilterChange }: QueryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('clicksCurrent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];
    
    // Filter by search
    if (searchTerm) {
      result = result.filter(q => 
        q.query.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Filter by category
    if (categoryFilter !== 'all') {
      result = result.filter(q => q.category === categoryFilter);
    }
    
    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortKey) {
        case 'query':
          comparison = a.query.localeCompare(b.query);
          break;
        case 'clicksCurrent':
          comparison = a.clicksCurrent - b.clicksCurrent;
          break;
        case 'clicksChange':
          comparison = a.clicksChangePercent - b.clicksChangePercent;
          break;
        case 'impressionsCurrent':
          comparison = a.impressionsCurrent - b.impressionsCurrent;
          break;
        case 'impressionsChange':
          comparison = a.impressionsChangePercent - b.impressionsChangePercent;
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return result;
  }, [data, searchTerm, categoryFilter, sortKey, sortDirection]);

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) {
      return <ArrowUpDown className="w-4 h-4 text-muted-foreground/50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-4 h-4 text-primary" />
      : <ArrowDown className="w-4 h-4 text-primary" />;
  };

  const formatChange = (change: number, isPercent: boolean = false) => {
    const prefix = change > 0 ? '+' : '';
    const suffix = isPercent ? '%' : '';
    const value = isPercent ? change.toFixed(1) : change.toLocaleString();
    
    return (
      <span className={cn(
        change > 0 && 'change-positive',
        change < 0 && 'change-negative',
        change === 0 && 'change-neutral'
      )}>
        {prefix}{value}{suffix}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search queries..."
            className="pl-10"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {filteredAndSortedData.length} of {data.length} queries
        </p>
      </div>
      
      <div className="overflow-x-auto border rounded-xl">
        <table className="data-table">
          <thead className="bg-muted/50">
            <tr>
              <th 
                className="cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('query')}
              >
                <div className="flex items-center gap-2">
                  Query <SortIcon columnKey="query" />
                </div>
              </th>
              <th 
                className="cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleSort('category')}
              >
                <div className="flex items-center gap-2">
                  Category <SortIcon columnKey="category" />
                </div>
              </th>
              <th 
                className="cursor-pointer hover:bg-muted transition-colors text-right"
                onClick={() => handleSort('clicksCurrent')}
              >
                <div className="flex items-center justify-end gap-2">
                  Clicks <SortIcon columnKey="clicksCurrent" />
                </div>
              </th>
              <th 
                className="cursor-pointer hover:bg-muted transition-colors text-right"
                onClick={() => handleSort('clicksChange')}
              >
                <div className="flex items-center justify-end gap-2">
                  Δ Clicks <SortIcon columnKey="clicksChange" />
                </div>
              </th>
              <th 
                className="cursor-pointer hover:bg-muted transition-colors text-right"
                onClick={() => handleSort('impressionsCurrent')}
              >
                <div className="flex items-center justify-end gap-2">
                  Impressions <SortIcon columnKey="impressionsCurrent" />
                </div>
              </th>
              <th 
                className="cursor-pointer hover:bg-muted transition-colors text-right"
                onClick={() => handleSort('impressionsChange')}
              >
                <div className="flex items-center justify-end gap-2">
                  Δ Impr. <SortIcon columnKey="impressionsChange" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedData.slice(0, visibleCount).map((row, index) => (
              <tr key={index} className="animate-fade-in" style={{ animationDelay: `${Math.min(index, 20) * 10}ms` }}>
                <td className="font-medium max-w-xs truncate">{row.query}</td>
                <td><CategoryBadge category={row.category} /></td>
                <td className="text-right font-mono">{row.clicksCurrent.toLocaleString()}</td>
                <td className="text-right font-mono">{formatChange(row.clicksChangePercent, true)}</td>
                <td className="text-right font-mono">{row.impressionsCurrent.toLocaleString()}</td>
                <td className="text-right font-mono">{formatChange(row.impressionsChangePercent, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredAndSortedData.length > visibleCount && (
          <div className="p-4 text-center bg-muted/30">
            <p className="text-sm text-muted-foreground mb-3">
              Showing {visibleCount} of {filteredAndSortedData.length} queries
            </p>
            <Button 
              variant="outline" 
              onClick={() => setVisibleCount(prev => prev + ITEMS_PER_PAGE)}
            >
              Show next {Math.min(ITEMS_PER_PAGE, filteredAndSortedData.length - visibleCount)} queries
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
