import { useEffect } from 'react';

export interface ShortcutHandlers {
  commandPalette?: () => void;
  newConversation?: () => void;
  toggleVoice?: () => void;
  toggleSettings?: () => void;
  focusInput?: () => void;
  cancelGeneration?: () => void;
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+').map((p) => p.trim());
  const key = parts[parts.length - 1];
  const needsMeta = parts.includes('meta') || parts.includes('cmd');
  const needsCtrl = parts.includes('ctrl') || parts.includes('control');
  const needsAlt = parts.includes('alt') || parts.includes('option');
  const needsShift = parts.includes('shift');

  const metaOk = needsMeta ? event.metaKey || event.ctrlKey : needsCtrl ? event.ctrlKey : !event.metaKey;
  const ctrlOk = needsCtrl && !needsMeta ? event.ctrlKey : true;
  const altOk = needsAlt ? event.altKey : !event.altKey;
  const shiftOk = needsShift ? event.shiftKey : !event.shiftKey;

  const eventKey = event.key.toLowerCase();
  const keyOk =
    eventKey === key ||
    (key === ',' && eventKey === ',') ||
    (key === 'escape' && eventKey === 'escape');

  if (needsMeta) {
    return (event.metaKey || event.ctrlKey) && altOk && (needsShift ? event.shiftKey : true) && keyOk;
  }

  return metaOk && ctrlOk && altOk && shiftOk && keyOk;
}

export function useKeyboardShortcuts(
  shortcuts: Record<string, string>,
  handlers: ShortcutHandlers,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (shortcuts.commandPalette && matchesShortcut(event, shortcuts.commandPalette)) {
        event.preventDefault();
        handlers.commandPalette?.();
        return;
      }

      if (shortcuts.toggleSettings && matchesShortcut(event, shortcuts.toggleSettings)) {
        event.preventDefault();
        handlers.toggleSettings?.();
        return;
      }

      if (shortcuts.newConversation && matchesShortcut(event, shortcuts.newConversation)) {
        if (isEditable && !event.metaKey && !event.ctrlKey) return;
        event.preventDefault();
        handlers.newConversation?.();
        return;
      }

      if (shortcuts.toggleVoice && matchesShortcut(event, shortcuts.toggleVoice)) {
        event.preventDefault();
        handlers.toggleVoice?.();
        return;
      }

      if (shortcuts.focusInput && matchesShortcut(event, shortcuts.focusInput)) {
        event.preventDefault();
        handlers.focusInput?.();
        return;
      }

      if (shortcuts.cancelGeneration && matchesShortcut(event, shortcuts.cancelGeneration)) {
        if (event.key === 'Escape') {
          handlers.cancelGeneration?.();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, handlers, enabled]);
}
