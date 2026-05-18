/**
 * The HeroUI v3 component catalog.
 *
 * Source of truth for *which* components exist and their atomic level
 * (slugs transcribed from heroui.com `react/llms.txt`; the
 * atom/molecule/organism grouping is derived per Brad Frost — HeroUI
 * has no upstream atomic grouping).
 *
 * Each entry resolves to a `ComponentSpec`. A small `RICH` registry
 * provides hand-authored builders; everything else uses the generic
 * token-driven stub. A rich builder that throws its
 * `*NotImplemented` sentinel (e.g. the Button contribution point)
 * transparently falls back to the stub, so the catalog always emits a
 * complete library.
 */

import type {
  AtomicLevel,
  BuildContext,
  ComponentSpec,
} from '../../design-system/atomic.ts';
import type { Child } from '../../pen/schema.ts';
import { buildButton } from './components/button.ts';
import { buildCard } from './components/card.ts';
import {
  buildAlert,
  buildAvatar,
  buildBadge,
  buildCheckbox,
  buildChip,
  buildInput,
  buildPagination,
  buildSwitch,
  buildTabs,
  buildTooltip,
} from './components/primitives.ts';
import {
  buildButtonGroup,
  buildCheckboxGroup,
  buildCloseButton,
  buildDescription,
  buildFieldset,
  buildInputGroup,
  buildInputOtp,
  buildKbd,
  buildLabelComp,
  buildLink,
  buildNumberField,
  buildRadioGroup,
  buildSearchField,
  buildSlider,
  buildTagGroup,
  buildTextArea,
  buildTextField,
  buildToggleButton,
  buildToggleButtonGroup,
} from './components/controls.ts';
import {
  buildAccordion,
  buildAlertDialog,
  buildAutocomplete,
  buildCalendar,
  buildColorPicker,
  buildComboBox,
  buildDatePicker,
  buildDateRangePicker,
  buildDisclosureGroup,
  buildDrawer,
  buildDropdown,
  buildForm,
  buildListBox,
  buildModal,
  buildPopover,
  buildRangeCalendar,
  buildSelect,
  buildTable,
  buildToast,
  buildToolbar,
} from './components/complex.ts';
import {
  buildBreadcrumbs,
  buildColorArea,
  buildColorField,
  buildColorSlider,
  buildColorSwatch,
  buildColorSwatchPicker,
  buildDateField,
  buildDisclosure,
  buildErrorMessage,
  buildFieldError,
  buildMeter,
  buildProgressBar,
  buildProgressCircle,
  buildScrollShadow,
  buildSeparator,
  buildSkeleton,
  buildSpinner,
  buildSurface,
  buildTimeField,
  buildTypography,
} from './components/display.ts';
import { buildStub } from './components/stub.ts';

interface CatalogEntry {
  id: string;
  name: string;
  level: AtomicLevel;
  /** HeroUI functional group (see `categoryOf`); every CATALOG entry
   *  is built with it and consumers read it — the field was missing. */
  category: string;
}

/**
 * Canonical HeroUI React export name for a catalog slug
 * ("date-range-picker" → "DateRangePicker", "list-box" → "ListBox").
 *
 * Simple per-segment PascalCase reproduces every HeroUI v3 export
 * name; `ACRONYMS` covers the few the docs spell with capitals.
 */
const ACRONYMS: Record<string, string> = { otp: 'OTP', kbd: 'Kbd' };

export function reactName(slug: string): string {
  return slug
    .split('-')
    .map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** npm import the React component comes from. */
export const HEROUI_PACKAGE = '@heroui/react';

/**
 * HeroUI's own functional category for each slug — the 15 groups the
 * docs index (heroui.com/docs/react/components) files components under.
 * Stamped into `metadata.category` so design→React tooling carries the
 * same taxonomy users see on the site. (Distinct from our atomic
 * atom/molecule/organism layering.)
 */
const CATEGORY_GROUPS: Record<string, string[]> = {
  Buttons: ['button', 'button-group', 'close-button', 'toggle-button', 'toggle-button-group'],
  Collections: ['dropdown', 'list-box', 'tag-group'],
  Colors: ['color-area', 'color-field', 'color-picker', 'color-slider', 'color-swatch', 'color-swatch-picker'],
  Controls: ['slider', 'switch'],
  'Data Display': ['badge', 'chip', 'table'],
  'Date and Time': ['calendar', 'date-field', 'date-picker', 'date-range-picker', 'range-calendar', 'time-field'],
  Feedback: ['alert', 'meter', 'progress-bar', 'progress-circle', 'skeleton', 'spinner'],
  Forms: ['checkbox', 'checkbox-group', 'description', 'error-message', 'field-error', 'fieldset', 'form', 'input', 'input-group', 'input-otp', 'label', 'number-field', 'radio-group', 'search-field', 'text-field', 'text-area'],
  Layout: ['card', 'separator', 'surface', 'toolbar'],
  Media: ['avatar'],
  Navigation: ['accordion', 'breadcrumbs', 'disclosure', 'disclosure-group', 'link', 'pagination', 'tabs'],
  Overlays: ['alert-dialog', 'drawer', 'modal', 'popover', 'toast', 'tooltip'],
  Pickers: ['autocomplete', 'combo-box', 'select'],
  Typography: ['kbd', 'typography'],
  Utilities: ['scroll-shadow'],
};

const CATEGORY_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_GROUPS).flatMap(([cat, slugs]) =>
    slugs.map((s) => [s, cat]),
  ),
);

// Atomic-design layering is OUR taxonomy; HeroUI's own functional
// category (the 15 groups on heroui.com/docs/react/components) is
// recorded separately in CATEGORY and stamped into each node's
// metadata. `radio` is intentionally absent — in v3 Radio is a
// dot-notation subpart of RadioGroup, not a standalone component
// (heroui.com/docs/react/components/radio is 404).
const ATOMS = [
  'button', 'close-button', 'toggle-button', 'link', 'kbd', 'label',
  'description', 'badge', 'chip', 'avatar', 'spinner', 'skeleton',
  'separator', 'surface', 'scroll-shadow', 'switch', 'checkbox',
  'slider', 'meter', 'progress-bar', 'progress-circle', 'color-swatch',
  'error-message', 'field-error', 'input', 'text-area', 'typography',
];

const MOLECULES = [
  'button-group', 'toggle-button-group', 'text-field', 'search-field',
  'number-field', 'color-field', 'date-field', 'time-field', 'input-group',
  'input-otp', 'fieldset', 'checkbox-group', 'radio-group', 'tag-group',
  'color-slider', 'color-area', 'color-swatch-picker', 'tooltip',
  'breadcrumbs', 'pagination', 'tabs', 'alert', 'disclosure', 'card',
];

const ORGANISMS = [
  'form', 'table', 'list-box', 'dropdown', 'accordion', 'disclosure-group',
  'toolbar', 'calendar', 'range-calendar', 'date-picker',
  'date-range-picker', 'color-picker', 'autocomplete', 'combo-box',
  'select', 'alert-dialog', 'drawer', 'modal', 'popover', 'toast',
];

/** HeroUI Storybook category order (welcome-page nav order). */
export const CATEGORY_ORDER = Object.keys(CATEGORY_GROUPS);

export function categoryOf(slug: string): string {
  return CATEGORY_BY_SLUG[slug] ?? 'Utilities';
}

const CATALOG: CatalogEntry[] = [
  ...ATOMS.map((id) => ({ id, name: reactName(id), level: 'atom' as const, category: categoryOf(id) })),
  ...MOLECULES.map((id) => ({ id, name: reactName(id), level: 'molecule' as const, category: categoryOf(id) })),
  ...ORGANISMS.map((id) => ({ id, name: reactName(id), level: 'organism' as const, category: categoryOf(id) })),
];

/** Hand-authored builders. Keyed by component id. */
const RICH: Record<string, (ctx: BuildContext) => Child> = {
  button: buildButton,
  card: buildCard,
  input: buildInput,
  badge: buildBadge,
  chip: buildChip,
  avatar: buildAvatar,
  switch: buildSwitch,
  checkbox: buildCheckbox,
  alert: buildAlert,
  tabs: buildTabs,
  tooltip: buildTooltip,
  pagination: buildPagination,
  'close-button': buildCloseButton,
  'toggle-button': buildToggleButton,
  link: buildLink,
  kbd: buildKbd,
  label: buildLabelComp,
  description: buildDescription,
  slider: buildSlider,
  'text-area': buildTextArea,
  'text-field': buildTextField,
  'search-field': buildSearchField,
  'number-field': buildNumberField,
  'input-group': buildInputGroup,
  'input-otp': buildInputOtp,
  fieldset: buildFieldset,
  'checkbox-group': buildCheckboxGroup,
  'radio-group': buildRadioGroup,
  'tag-group': buildTagGroup,
  'button-group': buildButtonGroup,
  'toggle-button-group': buildToggleButtonGroup,
  spinner: buildSpinner,
  skeleton: buildSkeleton,
  separator: buildSeparator,
  surface: buildSurface,
  'scroll-shadow': buildScrollShadow,
  meter: buildMeter,
  'progress-bar': buildProgressBar,
  'progress-circle': buildProgressCircle,
  'color-swatch': buildColorSwatch,
  'error-message': buildErrorMessage,
  'field-error': buildFieldError,
  typography: buildTypography,
  'color-field': buildColorField,
  'date-field': buildDateField,
  'time-field': buildTimeField,
  'color-slider': buildColorSlider,
  'color-area': buildColorArea,
  'color-swatch-picker': buildColorSwatchPicker,
  breadcrumbs: buildBreadcrumbs,
  disclosure: buildDisclosure,
  form: buildForm,
  table: buildTable,
  'list-box': buildListBox,
  dropdown: buildDropdown,
  accordion: buildAccordion,
  'disclosure-group': buildDisclosureGroup,
  toolbar: buildToolbar,
  calendar: buildCalendar,
  'range-calendar': buildRangeCalendar,
  'date-picker': buildDatePicker,
  'date-range-picker': buildDateRangePicker,
  'color-picker': buildColorPicker,
  autocomplete: buildAutocomplete,
  'combo-box': buildComboBox,
  select: buildSelect,
  'alert-dialog': buildAlertDialog,
  drawer: buildDrawer,
  modal: buildModal,
  popover: buildPopover,
  toast: buildToast,
};

export function heroUIComponents(): ComponentSpec[] {
  return CATALOG.map(({ id, name, level, category }) => ({
    id,
    name,
    level,
    category,
    build: (ctx: BuildContext): Child => {
      const rich = RICH[id];
      let node: Child;
      if (rich) {
        try {
          node = rich(ctx);
        } catch (err) {
          if (err instanceof Error && err.name.endsWith('NotImplemented')) {
            node = buildStub(id, name, level, ctx);
          } else {
            throw err;
          }
        }
      } else {
        node = buildStub(id, name, level, ctx);
      }
      // Stamp the HeroUI React mapping so design→code (Code Connect /
      // codegen) is mechanical: node name == the React export name,
      // metadata carries the import + slug.
      node.name = name;
      node.metadata = {
        type: 'component',
        ...node.metadata,
        react: name,
        package: HEROUI_PACKAGE,
        slug: id,
        atomic: level,
        category,
      };
      return node;
    },
  }));
}

/** Count of rich vs stub builders, for `list` / `gen-library` summaries. */
export function catalogStats(): { total: number; rich: number } {
  return { total: CATALOG.length, rich: Object.keys(RICH).length };
}
