import { useEffect, useState } from 'react';

/**
 * Validated JSON textarea — the v1 editor for structured sub-objects
 * (expressions, schemas, tags, policy, per-kind config). Applies only
 * when the text parses; a parse failure shows inline and never
 * corrupts the flow. Bespoke visual builders can replace instances of
 * this one field at a time later.
 */
export function JsonField({
  label,
  value,
  onApply,
  rows = 6,
  allowAbsent = false,
}: {
  label: string;
  value: unknown;
  onApply: (parsed: unknown) => void;
  rows?: number;
  /** Empty text applies `undefined` (removes the optional field). */
  allowAbsent?: boolean;
}) {
  const canonical = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(canonical);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the selection (and therefore `value`) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: canonical is derived from value
  useEffect(() => {
    setText(canonical);
    setError(null);
  }, [canonical]);

  const apply = () => {
    if (text.trim() === '') {
      if (allowAbsent) {
        setError(null);
        onApply(undefined);
      } else {
        setError('required');
      }
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onApply(parsed);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="field-label">{label}</span>
        {error && (
          <span className="text-[10px]" style={{ color: 'var(--error)' }}>
            {error}
          </span>
        )}
      </div>
      <textarea
        className={`json ${error ? 'invalid' : ''}`}
        rows={rows}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') apply();
        }}
      />
    </div>
  );
}
