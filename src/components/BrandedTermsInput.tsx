import { useState, useCallback } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface BrandedTermsInputProps {
  terms: string[];
  onChange: (terms: string[]) => void;
}

export function BrandedTermsInput({ terms, onChange }: BrandedTermsInputProps) {
  const [inputValue, setInputValue] = useState('');

  const addTerm = useCallback(() => {
    const trimmed = inputValue.trim().toLowerCase();
    if (trimmed && !terms.includes(trimmed)) {
      onChange([...terms, trimmed]);
      setInputValue('');
    }
  }, [inputValue, terms, onChange]);

  const removeTerm = useCallback((termToRemove: string) => {
    onChange(terms.filter(t => t !== termToRemove));
  }, [terms, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTerm();
    }
  }, [addTerm]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Branded Terms</span>
      </div>
      
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter brand term..."
          className="flex-1"
        />
        <Button onClick={addTerm} size="sm" variant="secondary">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      
      {terms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {terms.map((term) => (
            <span
              key={term}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-category-branded/10 text-category-branded rounded-full text-sm font-medium"
            >
              {term}
              <button
                onClick={() => removeTerm(term)}
                className="hover:bg-category-branded/20 rounded-full p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      
      <p className="text-xs text-muted-foreground">
        Add your brand names and variations to classify branded queries
      </p>
    </div>
  );
}
