import { cn } from '@/lib/utils';
import type { QueryCategory } from '@/types/query';
import { CATEGORY_LABELS } from '@/types/query';

interface CategoryBadgeProps {
  category: QueryCategory;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  return (
    <span className={cn(`category-badge category-${category}`, className)}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}
