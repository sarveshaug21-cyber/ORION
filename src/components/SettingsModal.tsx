import { useEffect, useState, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PermissionLevel, UserSettings } from '@/types';

interface SettingsModalProps {
  settings: UserSettings;
  onClose: () => void;
  onChange: (settings: Partial<UserSettings>) => void;
  providerName?: string;
  modelName?: string;
}

export function SettingsModal({
  settings,
  onClose,
  onChange,
  providerName,
  modelName,
}: SettingsModalProps) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    onChange(draft);
    onClose();
  };

  const patch = <K extends keyof UserSettings>(key: K, value: Partial<UserSettings[K]>) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...value } }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-orion-border bg-orion-bgSecondary shadow-glow-lg animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-orion-border px-5 py-4">
          <div>
            <h2 id="settings-title" className="text-lg font-semibold text-orion-text">
              Settings
            </h2>
            <p className="text-xs text-orion-textMuted">Configure ORION for this machine</p>
          </div>
          <button type="button" className="btn-ghost h-9 w-9 p-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <Tabs.Root defaultValue="ai" className="flex min-h-0 flex-1 flex-col">
          <Tabs.List className="flex shrink-0 gap-1 overflow-x-auto border-b border-orion-border px-4">
            {[
              ['ai', 'AI'],
              ['appearance', 'Appearance'],
              ['voice', 'Voice'],
              ['memory', 'Memory'],
              ['permissions', 'Permissions'],
              ['shortcuts', 'Shortcuts'],
            ].map(([value, label]) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className={cn(
                  'shrink-0 border-b-2 border-transparent px-3 py-3 text-sm text-orion-textDim transition-colors',
                  'hover:text-orion-text data-[state=active]:border-orion-accent data-[state=active]:text-orion-accent'
                )}
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="custom-scrollbar flex-1 overflow-y-auto p-5">
            <Tabs.Content value="ai" className="space-y-4 outline-none">
              <Field label="Active provider">
                <input
                  className="input"
                  value={draft.ai.activeProvider}
                  onChange={(e) => patch('ai', { activeProvider: e.target.value })}
                  placeholder={providerName || 'openai-compatible'}
                />
              </Field>
              <Field label="Model" hint={modelName ? `Current: ${modelName}` : undefined}>
                <input
                  className="input"
                  value={draft.ai.providers[0]?.model || ''}
                  onChange={(e) => {
                    const providers = [...draft.ai.providers];
                    if (providers[0]) {
                      providers[0] = { ...providers[0], model: e.target.value };
                    } else {
                      providers.push({
                        baseUrl: '',
                        apiKey: '',
                        model: e.target.value,
                      });
                    }
                    patch('ai', { providers });
                  }}
                  placeholder="gpt-4o-mini"
                />
              </Field>
              <Field label="Base URL">
                <input
                  className="input"
                  value={draft.ai.providers[0]?.baseUrl || ''}
                  onChange={(e) => {
                    const providers = [...draft.ai.providers];
                    if (providers[0]) {
                      providers[0] = { ...providers[0], baseUrl: e.target.value };
                    } else {
                      providers.push({
                        baseUrl: e.target.value,
                        apiKey: '',
                        model: '',
                      });
                    }
                    patch('ai', { providers });
                  }}
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Temperature (${draft.ai.temperature.toFixed(2)})`}>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={draft.ai.temperature}
                    onChange={(e) => patch('ai', { temperature: Number(e.target.value) })}
                    className="w-full accent-orion-accent"
                  />
                </Field>
                <Field label="Max tokens">
                  <input
                    type="number"
                    className="input"
                    value={draft.ai.maxTokens}
                    onChange={(e) => patch('ai', { maxTokens: Number(e.target.value) || 0 })}
                  />
                </Field>
              </div>
              <Field label="System prompt">
                <textarea
                  className="input min-h-[120px] font-mono text-sm"
                  value={draft.ai.systemPrompt}
                  onChange={(e) => patch('ai', { systemPrompt: e.target.value })}
                />
              </Field>
            </Tabs.Content>

            <Tabs.Content value="appearance" className="space-y-4 outline-none">
              <Field label="Theme">
                <select
                  className="input"
                  value={draft.appearance.theme}
                  onChange={(e) =>
                    patch('appearance', {
                      theme: e.target.value as UserSettings['appearance']['theme'],
                    })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </Field>
              <Field label="Accent color">
                <input
                  type="color"
                  className="h-10 w-full cursor-pointer rounded-lg border border-orion-border bg-orion-bgTeritary"
                  value={draft.appearance.accentColor}
                  onChange={(e) => patch('appearance', { accentColor: e.target.value })}
                />
              </Field>
              <Field label={`Font size (${draft.appearance.fontSize}px)`}>
                <input
                  type="range"
                  min={12}
                  max={18}
                  step={1}
                  value={draft.appearance.fontSize}
                  onChange={(e) => patch('appearance', { fontSize: Number(e.target.value) })}
                  className="w-full accent-orion-accent"
                />
              </Field>
              <Toggle
                label="Compact mode"
                checked={draft.appearance.compactMode}
                onCheckedChange={(v) => patch('appearance', { compactMode: v })}
              />
              <Toggle
                label="Animations"
                checked={draft.appearance.animationsEnabled}
                onCheckedChange={(v) => patch('appearance', { animationsEnabled: v })}
              />
              <Toggle
                label="Glass surfaces"
                checked={draft.appearance.glassmorphism}
                onCheckedChange={(v) => patch('appearance', { glassmorphism: v })}
              />
            </Tabs.Content>

            <Tabs.Content value="voice" className="space-y-4 outline-none">
              <Toggle
                label="Enable voice"
                checked={draft.voice.enabled}
                onCheckedChange={(v) => patch('voice', { enabled: v })}
              />
              <Field label="Speech-to-text">
                <select
                  className="input"
                  value={draft.voice.speechToText}
                  onChange={(e) =>
                    patch('voice', {
                      speechToText: e.target.value as UserSettings['voice']['speechToText'],
                    })
                  }
                >
                  <option value="browser">Browser</option>
                  <option value="whisper">Whisper</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
              <Field label="Text-to-speech">
                <select
                  className="input"
                  value={draft.voice.textToSpeech}
                  onChange={(e) =>
                    patch('voice', {
                      textToSpeech: e.target.value as UserSettings['voice']['textToSpeech'],
                    })
                  }
                >
                  <option value="browser">Browser</option>
                  <option value="elevenlabs">ElevenLabs</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
              <Field label="Language">
                <input
                  className="input"
                  value={draft.voice.language}
                  onChange={(e) => patch('voice', { language: e.target.value })}
                />
              </Field>
              <Toggle
                label="Auto-listen"
                checked={draft.voice.autoListen}
                onCheckedChange={(v) => patch('voice', { autoListen: v })}
              />
              {(draft.voice.speechToText !== 'browser' ||
                draft.voice.textToSpeech !== 'browser') && (
                <p className="rounded-lg border border-orion-border/80 bg-orion-bg/40 px-3 py-2 text-xs text-orion-textMuted">
                  Non-browser voice providers require backend wiring. UI preference is saved; runtime
                  may fall back until the provider is connected.
                </p>
              )}
            </Tabs.Content>

            <Tabs.Content value="memory" className="space-y-4 outline-none">
              <Field label="Short-term limit">
                <input
                  type="number"
                  className="input"
                  value={draft.memory.shortTermLimit}
                  onChange={(e) =>
                    patch('memory', { shortTermLimit: Number(e.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="Long-term retention (days)">
                <input
                  type="number"
                  className="input"
                  value={draft.memory.longTermRetentionDays}
                  onChange={(e) =>
                    patch('memory', { longTermRetentionDays: Number(e.target.value) || 0 })
                  }
                />
              </Field>
              <Field label={`Importance threshold (${draft.memory.importanceThreshold})`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.memory.importanceThreshold}
                  onChange={(e) =>
                    patch('memory', { importanceThreshold: Number(e.target.value) })
                  }
                  className="w-full accent-orion-accent"
                />
              </Field>
              <Toggle
                label="Auto-save from conversation"
                checked={draft.memory.autoSaveFromConversation}
                onCheckedChange={(v) => patch('memory', { autoSaveFromConversation: v })}
              />
              <Toggle
                label="Enable embeddings"
                checked={draft.memory.enableEmbeddings}
                onCheckedChange={(v) => patch('memory', { enableEmbeddings: v })}
              />
            </Tabs.Content>

            <Tabs.Content value="permissions" className="space-y-4 outline-none">
              <Field label="Default permission level">
                <select
                  className="input"
                  value={draft.permissions.defaultLevel}
                  onChange={(e) =>
                    patch('permissions', { defaultLevel: e.target.value as PermissionLevel })
                  }
                >
                  <option value="READ_ONLY">Read only</option>
                  <option value="SAFE_ACTION">Safe action</option>
                  <option value="REQUIRES_CONFIRMATION">Requires confirmation</option>
                </select>
              </Field>
              <Field label="Allowed paths" hint="One path per line">
                <textarea
                  className="input min-h-[88px] font-mono text-sm"
                  value={draft.permissions.allowedPaths.join('\n')}
                  onChange={(e) =>
                    patch('permissions', {
                      allowedPaths: e.target.value
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Blocked paths" hint="One path per line">
                <textarea
                  className="input min-h-[88px] font-mono text-sm"
                  value={draft.permissions.blockedPaths.join('\n')}
                  onChange={(e) =>
                    patch('permissions', {
                      blockedPaths: e.target.value
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Trusted tools" hint="Comma-separated tool names">
                <input
                  className="input font-mono text-sm"
                  value={draft.permissions.trustedTools.join(', ')}
                  onChange={(e) =>
                    patch('permissions', {
                      trustedTools: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            </Tabs.Content>

            <Tabs.Content value="shortcuts" className="space-y-3 outline-none">
              {(
                [
                  ['commandPalette', 'Command palette'],
                  ['newConversation', 'New conversation'],
                  ['toggleVoice', 'Toggle voice'],
                  ['toggleSettings', 'Toggle settings'],
                  ['focusInput', 'Focus input'],
                  ['cancelGeneration', 'Cancel generation'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    className="input font-mono text-sm"
                    value={draft.shortcuts[key]}
                    onChange={(e) => patch('shortcuts', { [key]: e.target.value })}
                  />
                </Field>
              ))}
            </Tabs.Content>
          </div>
        </Tabs.Root>

        <div className="flex justify-end gap-2 border-t border-orion-border px-5 py-4">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-orion-textMuted">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-orion-border/70 bg-orion-bg/30 px-3 py-2.5">
      <span className="text-sm text-orion-textDim">{label}</span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 rounded-full bg-orion-bgTeritary data-[state=checked]:bg-orion-accent"
      >
        <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </div>
  );
}
