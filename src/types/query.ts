export type QueryCategory = 
  | 'branded'
  | 'informational'
  | 'news'
  | 'product'
  | 'commercial'
  | 'transactional'
  | 'other';

export interface QueryData {
  query: string;
  clicksCurrent: number;
  clicksPrevious: number;
  impressionsCurrent: number;
  impressionsPrevious: number;
  ctrCurrent: number | null;
  ctrPrevious: number | null;
  positionCurrent: number | null;
  positionPrevious: number | null;
  category: QueryCategory;
  clicksChange: number;
  clicksChangePercent: number;
  impressionsChange: number;
  impressionsChangePercent: number;
}

export interface CategoryStats {
  category: QueryCategory;
  totalClicksCurrent: number;
  totalClicksPrevious: number;
  totalImpressionsCurrent: number;
  totalImpressionsPrevious: number;
  queryCount: number;
  clicksChange: number;
  clicksChangePercent: number;
  impressionsChangePercent: number;
  avgPositionCurrent: number;
  avgPositionPrevious: number;
  positionChange: number;
  avgCtrCurrent: number;
  avgCtrPrevious: number;
  ctrChange: number;
}

export interface ClassificationConfig {
  brandedTerms: string[];
  informationalPatterns: string[];
  commercialPatterns: string[];
  transactionalPatterns: string[];
  productTerms: string[];
}

export const CATEGORY_COLORS: Record<QueryCategory, string> = {
  branded: '#8b5cf6',
  informational: '#06b6d4',
  news: '#f97316',
  product: '#22c55e',
  commercial: '#a855f7',
  transactional: '#f43f5e',
  other: '#64748b',
};

export const CATEGORY_LABELS: Record<QueryCategory, string> = {
  branded: 'Branded',
  informational: 'Informational',
  news: 'News/Entities',
  product: 'Product',
  commercial: 'Commercial',
  transactional: 'Transactional',
  other: 'Other',
};
