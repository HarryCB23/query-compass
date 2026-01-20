import { cn } from '@/lib/utils';
import type { QueryCategory } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';

interface CategoryFilterProps {
  selected: QueryCategory | 'all';
  onChange: (category: QueryCategory | 'all') => void;
  counts?: Record<QueryCategory | 'all', number>;
}

const CATEGORIES: (QueryCategory | 'all')[] = [
  'all', 'branded', 'informational', 'news', 'product', 'commercial', 'transactional', 'other'
];

export function CategoryFilter({ selected, onChange, counts }: CategoryFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((category) => (
        <button
          key={category}
          onClick={() => onChange(category)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            selected === category
              ? category === 'all'
                ? 'bg-primary text-primary-foreground shadow-md'
                : `category-${category} shadow-md ring-2 ring-offset-2 ring-offset-background`
              : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
          )}
        >
          {category === 'all' ? 'All' : CATEGORY_LABELS[category]}
          {counts && (
            <span className="ml-2 opacity-70">
              ({counts[category]?.toLocaleString() || 0})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
