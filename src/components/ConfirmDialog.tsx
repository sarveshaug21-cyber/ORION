import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Allow',
  cancelLabel = 'Deny',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md animate-scale-in rounded-xl border border-orion-border bg-orion-bgSecondary shadow-glow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-orion-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-orion-warning/30 bg-orion-warning/10">
              <AlertTriangle className="h-4 w-4 text-orion-warning" />
            </div>
            <div>
              <h2 id="confirm-title" className="text-base font-semibold text-orion-text">
                {title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-orion-textDim">{message}</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={cn('btn-primary')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
