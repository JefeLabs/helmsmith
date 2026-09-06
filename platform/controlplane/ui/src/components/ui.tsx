import {
  Button,
  type ButtonProps,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  Spinner,
  TextArea,
  TextField,
} from '@heroui/react';
import type { ReactNode } from 'react';

/**
 * Small adapters over HeroUI v3 primitives.
 *
 * v3 removed the `Code` component and the all-in-one `Input` / `Textarea` /
 * `Select` props API in favour of compound components. These wrappers keep
 * the page code close to what it was under v2 so the intent stays readable,
 * while rendering the v3 anatomy underneath.
 */

// ── Code ────────────────────────────────────────────────────────────────

const CODE_BASE =
  'px-2 py-1 h-fit font-mono font-normal inline-block whitespace-nowrap rounded-sm text-sm';
const CODE_COLOR = {
  default: 'bg-default/40 text-foreground',
  danger: 'bg-danger/20 text-danger',
} as const;

export function Code({
  children,
  className = '',
  color = 'default',
}: {
  children: ReactNode;
  className?: string;
  color?: keyof typeof CODE_COLOR;
}) {
  return <code className={`${CODE_BASE} ${CODE_COLOR[color]} ${className}`}>{children}</code>;
}

// ── Spinner with a label (v3 Spinner has no label prop) ─────────────────

export function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Spinner size="sm" color="current" />
      <span>{label}</span>
    </div>
  );
}

// ── Button that shows a spinner while pending ───────────────────────────

export function PendingButton({
  pending = false,
  children,
  ...rest
}: Omit<ButtonProps, 'children' | 'isPending'> & { pending?: boolean; children: ReactNode }) {
  return (
    <Button isPending={pending} {...rest}>
      {({ isPending }) => (
        <>
          {isPending && <Spinner size="sm" color="current" />}
          {children}
        </>
      )}
    </Button>
  );
}

// ── Labeled text field / text area ──────────────────────────────────────

interface FieldProps {
  label?: string;
  placeholder?: string;
  description?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  isRequired?: boolean;
  isDisabled?: boolean;
  className?: string;
}

export function TextInput({
  label,
  placeholder,
  description,
  value,
  onValueChange,
  isRequired,
  isDisabled,
  className,
  onKeyDown,
}: FieldProps & { onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  return (
    <TextField
      value={value}
      onChange={onValueChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      className={className}
      aria-label={label ? undefined : placeholder}
    >
      {label && <Label>{label}</Label>}
      <Input fullWidth placeholder={placeholder} onKeyDown={onKeyDown} />
      {description && <Description>{description}</Description>}
    </TextField>
  );
}

export function TextAreaField({
  label,
  placeholder,
  description,
  value,
  onValueChange,
  isRequired,
  isDisabled,
  className,
  rows = 3,
}: FieldProps & { rows?: number }) {
  return (
    <TextField
      value={value}
      onChange={onValueChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      className={className}
      aria-label={label ? undefined : placeholder}
    >
      {label && <Label>{label}</Label>}
      <TextArea fullWidth placeholder={placeholder} rows={rows} style={{ resize: 'vertical' }} />
      {description && <Description>{description}</Description>}
    </TextField>
  );
}

// ── Select with a flat item list ────────────────────────────────────────

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
}

export function SelectField({
  label,
  placeholder,
  description,
  value,
  onValueChange,
  options,
  isDisabled,
}: {
  label: string;
  placeholder?: string;
  description?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  isDisabled?: boolean;
}) {
  return (
    <Select
      value={value === '' ? null : value}
      onChange={(key) => {
        if (key != null) onValueChange(String(key));
      }}
      placeholder={placeholder}
      isDisabled={isDisabled}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {description && <Description>{description}</Description>}
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              <Label>{o.label}</Label>
              {o.description && <Description>{o.description}</Description>}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
