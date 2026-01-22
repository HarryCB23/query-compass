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
        <div className="flex flex-col">
          <h3 className="font-semibold text-foreground tracking-tight">
            {title}
          </h3>
          <div className="w-10 h-0.5 bg-primary/50 rounded-full mt-1.5" />
        </div>
      </div>
      {subtitle && (
        <span className="text-xs text-muted-foreground">
          {subtitle}
        </span>
      )}
    </div>
  );
}
