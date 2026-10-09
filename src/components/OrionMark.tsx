import { cn } from '@/lib/utils';

interface OrionMarkProps {
  size?: number;
  className?: string;
  pulsing?: boolean;
}

export function OrionMark({ size = 32, className, pulsing = false }: OrionMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <rect width="32" height="32" rx="7" fill="#0a0f1a" stroke="#1e293b" strokeWidth="1" />
      <circle cx="16" cy="16" r="10" stroke="#06b6d4" strokeWidth="1.25" opacity="0.85" />
      <circle cx="16" cy="16" r="6" stroke="#06b6d4" strokeWidth="1" opacity="0.35" />
      <circle
        cx="16"
        cy="16"
        r="2.5"
        fill="#06b6d4"
        className={pulsing ? 'origin-center animate-pulse' : undefined}
        opacity="0.9"
      />
    </svg>
  );
}
