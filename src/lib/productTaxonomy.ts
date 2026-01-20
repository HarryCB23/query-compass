// Product taxonomy terms extracted from Google Product Taxonomy
// These are searchable product category terms for query classification

let cachedTerms: string[] | null = null;

export async function loadProductTaxonomy(): Promise<string[]> {
  if (cachedTerms) return cachedTerms;
  
  try {
    const response = await fetch('/data/google_product_taxonomy.txt');
    if (!response.ok) {
      console.error('Failed to load product taxonomy');
      return [];
    }
    
    const text = await response.text();
    const lines = text.split('\n');
    
    // Extract unique product terms from the taxonomy
    const terms = new Set<string>();
    
    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue;
      
      // Format: "ID - Category > Subcategory > Product"
      const parts = line.split(' - ');
      if (parts.length < 2) continue;
      
      const categoryPath = parts[1];
      const categories = categoryPath.split(' > ');
      
      // Add each category level as a searchable term
      for (const cat of categories) {
        const cleaned = cat.trim().toLowerCase();
        if (cleaned.length > 2) {
          terms.add(cleaned);
        }
      }
    }
    
    cachedTerms = Array.from(terms);
    console.log(`Loaded ${cachedTerms.length} product terms`);
    return cachedTerms;
  } catch (error) {
    console.error('Error loading product taxonomy:', error);
    return [];
  }
}

// Quick check for common product categories without loading full taxonomy
export const COMMON_PRODUCT_TERMS = [
  'laptop', 'phone', 'computer', 'tv', 'television', 'camera', 'headphones',
  'tablet', 'watch', 'shoes', 'dress', 'shirt', 'pants', 'jacket',
  'sofa', 'chair', 'table', 'desk', 'bed', 'mattress',
  'car', 'bike', 'bicycle', 'motorcycle',
  'refrigerator', 'washer', 'dryer', 'microwave', 'oven', 'dishwasher',
  'toys', 'games', 'console', 'playstation', 'xbox', 'nintendo',
  'book', 'books', 'novel', 'magazine',
  'perfume', 'makeup', 'skincare', 'cosmetics',
  'supplements', 'vitamins', 'medicine',
  'pet food', 'dog food', 'cat food',
  'furniture', 'appliances', 'electronics', 'clothing', 'apparel'
];
