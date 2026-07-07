---
description: Generate stories for a specific component following CSF format, project conventions, and the addons/provider stack defined in the runtime manifest. Reads from the manifest for organization conventions, addon detection, and provider stack; reads from .pencil-tone/.pencil-editorial/.pencil-brand for realistic content.
argument-hint: <component-name-or-path> [--update] [--variants size,color,variant,states] [--no-interaction-tests]
allowed-tools: Read, Write, Edit, Bash
---

Generate Storybook stories for a component following CSF format
and project conventions defined in the runtime manifest. Outputs
a `<Component>.stories.tsx` file alongside the component.

## Phase 0: discovery

1. Read `product/.pencil-storybook.json` (the runtime manifest).
   - If missing, auto-trigger init for required fields:
     `storybook.framework`, `componentOrganization`,
     `addons`, `providerStack`, `lint`
2. Read suite content sources when present:
   - `product/.pencil-tone.json` — voice for sample copy
   - `product/.pencil-editorial.json` — writing conventions
   - `product/.pencil-brand.json` — brand name, key terms
3. Verify Storybook can run (don't require it to be running for
   gen; only verification commands need that):
   ```bash
   PACKAGE_ROOT=$(jq -r '.storybook.packageRoot' product/.pencil-storybook.json)
   test -f "${PACKAGE_ROOT}/package.json"
   ```

## Phase 1: locate the component

`$ARGUMENTS[0]` can be a component name or a file path.

### By component name

```bash
COMPONENT_ROOT=$(jq -r '.componentOrganization.componentRoot' product/.pencil-storybook.json)
NAME="$1"

# Case-insensitive search, excluding stories/tests/index/types
find "$COMPONENT_ROOT" -name "${NAME}*" -name "*.tsx" \
  ! -name "*.stories.*" ! -name "*.test.*" \
  ! -name "index.*" ! -name "types.*" ! -name "*.mock.*" \
  ! -path "*/mocks/*" ! -path "*/test/*"
```

If multiple matches, surface and prompt user to pick:

> Multiple matches for "Button":
>   1. components/core/atoms/button/Button.tsx
>   2. components/admin/molecules/button-group/Button.tsx
>
> Which? [1/2]

If no matches, prompt for the correct path.

### By file path

If `$ARGUMENTS[0]` looks like a path (contains `/` or starts
with `./`), use it directly. Verify the file exists; reject if
it has `.stories.` or `.test.` in the name.

### Verify it's a component file

A component file should:
- Export a React component (named or default)
- Have a `.tsx` extension (or `.jsx` for non-TypeScript projects)
- Not be a hook, util, type definition, or mock

If the file is ambiguous (e.g., a util that exports a component
incidentally), prompt:

> File `<path>` doesn't clearly export a single React
> component. Components found:
>   - LoginForm (default export)
>   - LoginFormHeader (named export)
>
> Generate stories for which? [LoginForm]

## Phase 2: analyze the component

Read the component source. Extract:

### Props interface

Look for:
- TypeScript interface: `interface ComponentNameProps { ... }`
- TypeScript type: `type ComponentNameProps = { ... }`
- JSDoc-typed props on a function
- Default values from destructuring or defaultProps

Per prop, capture:
- Name
- TypeScript type (or inferred type)
- Required (has `?` modifier or default value)
- Enum values when type is a union of literals
- JSDoc description if present

### Variants from props

Match prop names against patterns to identify variant types:

| Prop name pattern | Variant type | Story name |
| --- | --- | --- |
| `size`, `scale`, `dimension` (enum-typed) | size | `AllSizes` |
| `color`, `intent` (color-shaped enum) | color | `AllColors` |
| `variant` (style-shaped enum) | variant | `AllVariants` |
| `disabled` (boolean) | state | `Disabled` |
| `loading` (boolean) | state | `Loading` |
| `error`, `errorMessage` (boolean/string) | state | `Error` |
| `selected` (boolean) | state | `Selected` |

### Dependencies

Scan imports for:
- Data fetching: `fetch`, `axios`, `@tanstack/react-query`,
  `useSWR`, custom hooks named `use*Query`, `use*Data`
- State management: `redux`, `zustand`, `jotai`, `recoil`
- Routing: `next/router`, `next/navigation`,
  `react-router`
- Forms: `react-hook-form`, `formik`, `final-form`
- Custom providers from project (matched against manifest's
  `providerStack`)

### Atomic level / category

Derive from the component's file path and the manifest's
`componentOrganization.hierarchy`:

```python
# Pseudocode
component_path = "components/core/atoms/button/Button.tsx"
component_root = "components/"
relative = "core/atoms/button/Button.tsx"

# For atomic-design with sections:
# Path components: [section, category, component-dir, file]
# section = "core" → "Core"
# category = "atoms" → "Atoms"
# component = "button" → "Button"
# title = "Core/Atoms/Button"
```

Apply the manifest's `componentOrganization.titlePattern`.

### Existing stories check

```bash
COMPONENT_DIR=$(dirname "$COMPONENT_PATH")
COMPONENT_NAME=$(basename "$COMPONENT_PATH" .tsx)

ls "${COMPONENT_DIR}/${COMPONENT_NAME}.stories.tsx" 2>/dev/null || \
  ls "${COMPONENT_DIR}/${COMPONENT_NAME}.stories.ts" 2>/dev/null
```

If a story file exists:

- **Default behavior**: surface and prompt:
  > Story file already exists at `<path>`. Choose:
  >   1. Update — refresh based on current component shape
  >   2. Replace — overwrite entirely (loses manual edits)
  >   3. Cancel
  > [1/2/3]
- **`--update` flag**: skip prompt, perform update mode
- Update mode preserves manual additions (custom decorators,
  custom render functions, custom args) and refreshes generated
  parts (variant matrices, computed argTypes)

### Compound exports

Check the component file for compound pattern:

```typescript
// Pattern A: assign-after-declaration
const Component = (props) => { ... };
Component.Trigger = (props) => { ... };
Component.Content = (props) => { ... };
export { Component };

// Pattern B: namespace export
export const Component = {
  Root: (props) => { ... },
  Trigger: (props) => { ... },
  Content: (props) => { ... },
};
```

When detected, generate a Compound story showing the compound
usage pattern.

## Phase 3: derive title

Apply the title pattern from the manifest:

```bash
TITLE_PATTERN=$(jq -r '.componentOrganization.titlePattern' product/.pencil-storybook.json)
# E.g., "<Section>/<Category>/<Component>"
```

Substitute pattern variables from the component's path
analysis. Validate the result by checking if any existing story
shares the same title (would cause conflict in Storybook UI).

## Phase 4: generate the story file

Build the story file content:

### File scaffolding

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { ComponentName } from "./ComponentName";
// Additional imports as needed (mocks, test utilities)

const meta = {
  title: "<derived-title>",
  component: ComponentName,
  parameters: {
    layout: "centered", // or "padded" / "fullscreen"
  },
  tags: ["autodocs"],
  argTypes: {
    // generated per detected prop
  },
} satisfies Meta<typeof ComponentName>;

export default meta;
type Story = StoryObj<typeof meta>;

// Stories
```

### `parameters.layout` selection

- `"centered"` for atoms and small molecules (default)
- `"padded"` for larger molecules, organisms with surrounding
  whitespace
- `"fullscreen"` for templates, layouts, full-page components

Detection heuristic: atomic level → layout. Atoms/molecules →
centered; organisms → padded; templates → fullscreen. Override
via `--layout <value>` flag.

### `argTypes` generation

For each detected prop, generate appropriate control:

```typescript
argTypes: {
  // string → text
  label: { control: "text" },

  // boolean → boolean
  disabled: { control: "boolean" },

  // enum → select
  size: {
    control: "select",
    options: ["sm", "md", "lg"],
  },

  // number → number
  count: { control: "number", min: 0, max: 100 },

  // color-shaped enum → color select with swatches
  color: {
    control: "select",
    options: ["default", "primary", "secondary", "success",
              "warning", "danger"],
  },

  // function → action
  onClick: { action: "clicked" },

  // complex → exclude (don't auto-generate control)
  data: { control: false },
}
```

### Default story

```typescript
export const Default: Story = {
  args: {
    // minimal required props with realistic values
  },
};
```

Realistic values from:
1. JSDoc `@example` if present
2. Brand JSON for product/brand name fields
3. Tone/editorial JSON for copy fields
4. Domain heuristics from prop name patterns

### Variant stories

Generate per detected variant types (filtered by `--variants`
flag if provided):

#### `AllSizes`

When size prop with enum is detected:

```typescript
export const AllSizes: Story = {
  render: (args) => (
    <div className="flex gap-4 items-center">
      <ComponentName {...args} size="sm" />
      <ComponentName {...args} size="md" />
      <ComponentName {...args} size="lg" />
    </div>
  ),
};
```

Adjust enum values to match what's actually in the prop's type.

#### `AllColors`

When color/intent prop detected:

```typescript
export const AllColors: Story = {
  render: (args) => (
    <div className="flex gap-4">
      {["default", "primary", "secondary", "success",
        "warning", "danger"].map(color => (
        <ComponentName key={color} {...args} color={color} />
      ))}
    </div>
  ),
};
```

#### `AllVariants`

When variant prop with style values detected:

```typescript
export const AllVariants: Story = {
  render: (args) => (
    <div className="flex gap-4">
      <ComponentName {...args} variant="solid" />
      <ComponentName {...args} variant="bordered" />
      <ComponentName {...args} variant="flat" />
    </div>
  ),
};
```

#### State stories

For each state prop (disabled, loading, error, etc.):

```typescript
export const Disabled: Story = {
  args: { ...defaultArgs, disabled: true },
};

export const Loading: Story = {
  args: { ...defaultArgs, loading: true },
};
```

#### Compound

When compound exports detected:

```typescript
export const Compound: Story = {
  render: () => (
    <ComponentName>
      <ComponentName.Trigger>Open</ComponentName.Trigger>
      <ComponentName.Content>
        <p>Content here</p>
      </ComponentName.Content>
    </ComponentName>
  ),
};
```

### MSW handler wiring (when applicable)

If component has data-fetching dependencies AND msw is in
manifest's addons:

```bash
MSW_ADDON=$(jq -r '.addons.msw // empty' product/.pencil-storybook.json)
test -n "$MSW_ADDON"
```

Add MSW parameters and check for handler file:

```typescript
import { myHandlers } from "./mocks/handlers";

const meta = {
  title: "...",
  component: ComponentName,
  parameters: {
    layout: "padded",
    msw: {
      handlers: myHandlers,
    },
  },
  // ...
};
```

If `mocks/handlers.ts` doesn't exist, surface in report:

> Component fetches data; MSW handlers expected at
> `<component-dir>/mocks/handlers.ts` but file is missing.
> Generate handler stub now? [Y/n]

If yes, generate a stub handler file with placeholder handlers
matching the detected fetch patterns.

### Interaction tests (when applicable)

If component has interactive props AND `@storybook/test` is in
manifest's addons AND `--no-interaction-tests` was NOT provided:

```typescript
import { expect, userEvent, within } from "@storybook/test";

export const ClickHandler: Story = {
  args: { /* default args */ },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");
    await userEvent.click(button);
    // assertion based on detected handler
  },
};
```

The play function's body is heuristic — it does what's
plausible for the detected interaction pattern. Users refine
the assertion to match actual component behavior.

## Phase 5: write the story file

```bash
COMPONENT_DIR=$(dirname "$COMPONENT_PATH")
STORY_FILE="${COMPONENT_DIR}/${COMPONENT_NAME}.stories.tsx"

# Write content (in update mode, preserve manual sections)
```

For update mode, preserve:
- Imports the user added
- Manual decorators
- Custom render functions
- Manual story exports not generated by gen
- argTypes overrides (when user has more specific control
  config than gen generates)

Replace:
- Generated variant stories
- Generated argTypes for props with no manual override
- Default story args (only when generated content is detected
  to be stale)

## Phase 6: lint after write

```bash
LINT_CMD=$(jq -r '.lint.command' product/.pencil-storybook.json)
LINT_DIR=$(jq -r '.lint.workingDir' product/.pencil-storybook.json)

(cd "$LINT_DIR" && $LINT_CMD --files "$STORY_FILE")
```

If lint fails, surface failures and offer to attempt fixes:

> Lint failed on generated story:
>   - Unused import 'useEffect' (auto-fixable)
>   - Missing trailing comma (auto-fixable)
>
> Apply auto-fixes? [Y/n]

If lint command supports `--apply` / `--fix` / `--write`, invoke
that mode. If it doesn't auto-fix, surface the failures and let
the user resolve manually.

## Phase 7: optional verification

If Storybook is running, verify the new story renders:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
curl -sf "$LOCAL_URL" > /dev/null 2>&1 && {
  STORY_ID=$(derive_story_id_from_title "$TITLE")
  curl -sf "${LOCAL_URL}/index.json" | grep -q "$STORY_ID" && \
    echo "Story registered in Storybook index"
}
```

If running and the story doesn't appear in the index, the user
may need to wait for Storybook's HMR to pick up the new file
(typically 2-5 seconds). The command waits with a timeout
before reporting.

## Phase 8: report

```
=== Story Generation Report ===
Component:     Button (components/core/atoms/button/Button.tsx)
Title:         Core/Atoms/Button
Story file:    components/core/atoms/button/Button.stories.tsx
Stories:       6 generated
  - Default
  - AllSizes (3 sizes)
  - AllColors (6 colors)
  - AllVariants (3 variants)
  - Disabled
  - LoadingClick (interaction test)

Detected:
  Atomic level:  atom
  Variants:      size, color, variant, state (disabled)
  Interactions: onClick handler
  MSW needed:   no

Lint:          pass
Storybook:     story registered (verified)
```

If MSW handler stub was generated:

```
Also generated: components/core/atoms/button/mocks/handlers.ts
                (stub — fill in with realistic mock responses)
```

## What this command does NOT do

- **Replace existing stories without prompting.** Update mode
  preserves manual content; replace mode requires explicit
  confirmation.
- **Generate stories for components that don't exist.** If the
  named component isn't found, the command stops.
- **Auto-fill realistic content perfectly.** The realistic
  content from tone/editorial/brand sources is best-effort;
  users review and refine.
- **Modify component files.** This command writes only the
  story file (and MSW handler stub if requested).
- **Configure addons.** Addons are detected from the manifest;
  if a needed addon is missing, the command surfaces the gap
  but doesn't install it.

## Examples

```bash
# Generate stories for a component by name
/core:frameworks:storybook:stories:gen Button

# Generate by file path
/core:frameworks:storybook:stories:gen components/core/atoms/button/Button.tsx

# Update existing stories (refresh after API changes)
/core:frameworks:storybook:stories:gen Button --update

# Limit variants generated
/core:frameworks:storybook:stories:gen Button --variants size,color

# Skip interaction tests
/core:frameworks:storybook:stories:gen Modal --no-interaction-tests
```
