import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}

export function SectionHeader({ icon, title, subtitle, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-5', className)}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
            {icon}
          </div>
        )}
        <h3 className="font-semibold text-foreground tracking-tight relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-12 after:h-0.5 after:bg-primary/40 after:rounded-full">
          {title}
        </h3>
      </div>
      {subtitle && (
        <span className="text-xs text-muted-foreground">
          {subtitle}
        </span>
      )}
    </div>
  );
}
