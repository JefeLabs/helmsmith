/**
 * Child-process fixture for `registry.test.ts`: mounts one component that
 * binds `x`, lets the test renderer run, presses `x`, and prints
 * `RENDERS=<n>` and `HANDLED=<n>`.
 *
 *   bun keybinding-render.ts <string|function> <themeDir>
 *
 * `string` binds the key name `'x'`; `function` binds an inline matcher
 * `(k) => k.name === 'x'`, a new function every render, the way
 * SelectList, Confirm, Table and Menu write theirs.
 *
 * Exits 3 with `RENDER_LOOP` the moment the component passes 200 renders: a
 * registration loop starves the event loop, so the fixture would otherwise
 * never get back to report.
 */
import { testRender } from '@opentui/react/test-utils';
import { createElement } from 'react';
import { KeyboardProvider, useKeybinding } from '../registry.tsx';

const matcher = process.argv[2];
if (matcher !== 'string' && matcher !== 'function') {
  throw new Error('usage: keybinding-render.ts <string|function> <themeDir>');
}
const RENDER_LIMIT = 200;
let renders = 0;
let handled = 0;

function BindsX() {
  renders++;
  if (renders > RENDER_LIMIT) {
    process.stdout.write(`RENDER_LOOP=more than ${RENDER_LIMIT} renders\n`);
    process.exit(3);
  }
  useKeybinding(matcher === 'string' ? 'x' : (k) => k.name === 'x', 'do x', () => {
    handled++;
  });
  return null;
}

console.error = () => {}; // React's act() warnings; not what this fixture measures
const setup = await testRender(createElement(KeyboardProvider, null, createElement(BindsX)), {
  width: 40,
  height: 5,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 10; i++) {
  await setup.renderOnce();
  await sleep(20);
}
setup.mockInput.pressKey('x');
for (let i = 0; i < 5; i++) {
  await setup.renderOnce();
  await sleep(20);
}

process.stdout.write(`RENDERS=${renders}\nHANDLED=${handled}\n`);
setup.renderer.destroy();
process.exit(0);
