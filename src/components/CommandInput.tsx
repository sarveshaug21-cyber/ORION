import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Mic, MicOff, Send, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { AIState } from '@/types';

const SUGGESTIONS = [
  'Show my system status',
  'List files in the current directory',
  'What can you help me with?',
  'Check current memory usage',
];

interface CommandInputProps {
  onSend: (content: string) => void;
  onCancel?: () => void;
  canSend: boolean;
  connectionStatus: 'online' | 'connecting' | 'offline';
  aiState: AIState;
  voiceEnabled?: boolean;
  language?: string;
  error?: string | null;
  onClearError?: () => void;
  onListeningChange?: (listening: boolean) => void;
  inputRef?: RefObject<HTMLTextAreaElement>;
}

export function CommandInput({
  onSend,
  onCancel,
  canSend,
  connectionStatus,
  aiState,
  voiceEnabled = false,
  language = 'en-US',
  error,
  onClearError,
  onListeningChange,
  inputRef: externalRef,
}: CommandInputProps) {
  const [value, setValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef || internalRef;
  const listId = useId();
  const generationBusy = aiState === 'THINKING' || aiState === 'EXECUTING';
  const busy =
    generationBusy || aiState === 'LISTENING' || aiState === 'WAITING_FOR_PERMISSION';
  const speech = useSpeechRecognition(language);

  useEffect(() => {
    if (speech.transcript) {
      setValue(speech.transcript);
      setActiveSuggestion(-1);
    }
  }, [speech.transcript]);

  useEffect(() => {
    onListeningChange?.(speech.listening);
  }, [speech.listening, onListeningChange]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, textareaRef]);

  const filtered = value.trim()
    ? SUGGESTIONS.filter((s) => s.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 5)
    : SUGGESTIONS.slice(0, 5);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || !canSend || busy) return;
    onSend(text);
    setValue('');
    setShowSuggestions(false);
    onClearError?.();
  }, [value, canSend, busy, onSend, onClearError]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (showSuggestions && activeSuggestion >= 0 && filtered[activeSuggestion]) {
        setValue(filtered[activeSuggestion]);
        setShowSuggestions(false);
        setActiveSuggestion(-1);
        return;
      }
      submit();
      return;
    }

    if (e.key === 'Escape') {
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }
      onCancel?.();
      return;
    }

    if (showSuggestions && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      } else if (e.key === 'Tab' && activeSuggestion >= 0 && filtered[activeSuggestion]) {
        e.preventDefault();
        setValue(filtered[activeSuggestion]);
        setShowSuggestions(false);
        setActiveSuggestion(-1);
      }
    }
  };

  const toggleMic = () => {
    if (!voiceEnabled) return;
    speech.toggle();
  };

  return (
    <div className="relative border-t border-orion-border bg-orion-bgSecondary/50 px-4 py-4 md:px-8">
      <div className="mx-auto w-full max-w-3xl">
        {(error || speech.error) && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-lg border border-orion-error/30 bg-orion-error/10 px-3 py-2 text-sm text-orion-error"
          >
            <span className="flex-1">{error || speech.error}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-orion-error/20 focus-ring"
              onClick={() => {
                onClearError?.();
                speech.clearError();
              }}
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {showSuggestions && filtered.length > 0 && !busy && (
          <ul
            id={listId}
            role="listbox"
            className="mb-2 overflow-hidden rounded-lg border border-orion-border bg-orion-bgSecondary shadow-glow"
          >
            {filtered.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeSuggestion}
                className={cn(
                  'flex w-full cursor-pointer px-3 py-2.5 text-left text-sm transition-colors',
                  index === activeSuggestion
                    ? 'bg-orion-accent/10 text-orion-accent'
                    : 'text-orion-textDim hover:bg-orion-bgTeritary'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(suggestion);
                  setShowSuggestions(false);
                  setActiveSuggestion(-1);
                  textareaRef.current?.focus();
                }}
              >
                <span
                  className={cn(
                    'mr-2.5 mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    index === activeSuggestion ? 'bg-orion-accent' : 'bg-orion-borderLight'
                  )}
                />
                {suggestion}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSubmit} className="relative">
          <div
            className={cn(
              'flex items-end gap-2 rounded-xl border bg-orion-bgTeritary/80 px-3 py-2 transition-all',
              'focus-within:border-orion-accent/50 focus-within:ring-2 focus-within:ring-orion-accent/15',
              error || speech.error ? 'border-orion-error/50' : 'border-orion-border',
              speech.listening && 'border-orion-accent/40',
              aiState === 'THINKING' &&
                'border-orion-accent/35 shadow-[0_0_0_1px_rgba(6,182,212,0.05)]',
              (aiState === 'EXECUTING' || aiState === 'WAITING_FOR_PERMISSION') &&
                'border-orion-warning/35'
            )}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setShowSuggestions(true);
                setActiveSuggestion(-1);
                onClearError?.();
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                speech.listening
                  ? 'Listening…'
                  : busy
                    ? 'ORION is working…'
                    : 'Command ORION…'
              }
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={showSuggestions}
              aria-label="Command ORION"
              aria-activedescendant={
                showSuggestions && activeSuggestion >= 0 ? `${listId}-${activeSuggestion}` : undefined
              }
              className="max-h-40 min-h-[48px] flex-1 resize-none bg-transparent py-3 text-[15px] leading-relaxed text-orion-text placeholder:text-orion-textMuted focus:outline-none"
            />

            <div className="mb-1 flex items-center gap-1">
              {voiceEnabled && (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={!speech.supported || (busy && !speech.listening)}
                  title={
                    !speech.supported
                      ? 'Speech recognition unavailable'
                      : speech.listening
                        ? 'Stop listening'
                        : 'Start voice input'
                  }
                  className={cn(
                    'btn-ghost h-9 w-9 rounded-lg p-0',
                    speech.listening && 'bg-orion-accent/15 text-orion-accent'
                  )}
                  aria-pressed={speech.listening}
                >
                  {speech.listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                </button>
              )}

              {generationBusy ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="btn-secondary h-9 w-9 rounded-lg p-0"
                  title="Stop response (Esc)"
                  aria-label="Cancel generation"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend || busy || !value.trim()}
                  className="btn-primary h-9 w-9 rounded-lg p-0"
                  title={
                    !canSend
                      ? 'Waiting for ORION to reconnect'
                      : busy
                        ? 'Wait for the current action to finish'
                        : 'Send (Enter)'
                  }
                  aria-label="Send command"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </form>

        <div className="mt-2 flex items-center justify-between text-[11px] text-orion-textMuted">
          <span>
            <kbd className="rounded border border-orion-border bg-orion-bg px-1.5 py-0.5 font-mono">
              Enter
            </kbd>{' '}
            send ·{' '}
            <kbd className="rounded border border-orion-border bg-orion-bg px-1.5 py-0.5 font-mono">
              Shift+Enter
            </kbd>{' '}
            newline ·{' '}
            <kbd className="rounded border border-orion-border bg-orion-bg px-1.5 py-0.5 font-mono">
              Cmd/Ctrl K
            </kbd>{' '}
            palette
          </span>
          {busy && (
            <span
              className={cn(
                'font-medium uppercase tracking-wide',
                aiState === 'EXECUTING' || aiState === 'WAITING_FOR_PERMISSION'
                  ? 'text-orion-warning'
                  : 'text-orion-accent'
              )}
              role="status"
              aria-live="polite"
            >
              {aiState === 'WAITING_FOR_PERMISSION'
                ? 'Permission required'
                : aiState === 'LISTENING'
                  ? 'Listening'
                  : aiState}
            </span>
          )}
        </div>
        {connectionStatus !== 'online' && (
          <p role="status" className="mt-2 text-xs text-orion-warning">
            {connectionStatus === 'connecting'
              ? 'Connecting to ORION. Your draft will be kept.'
              : 'ORION is offline. Your draft will be kept.'}
          </p>
        )}
      </div>
    </div>
  );
}
