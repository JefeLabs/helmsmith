import type { ViewContext, ViewFn } from './types.js';

/**
 * Run a view-stack navigation loop.
 *
 * Starts with `initialView` on the stack. Each view returns a NavigationAction:
 *   push    -> push a new view onto the stack
 *   pop     -> go back one level
 *   replace -> swap the current view in place
 *   quit    -> exit the loop entirely
 *
 * If the stack empties (all views popped), the loop exits naturally.
 * Errors in views are logged and cause immediate exit.
 */
export async function runNavigator(initialView: ViewFn, ctx: ViewContext): Promise<void> {
  const stack: ViewFn[] = [initialView];

  while (stack.length > 0) {
    const currentView = stack[stack.length - 1];

    try {
      const action = await currentView(ctx);

      switch (action.type) {
        case 'push':
          stack.push(action.view);
          break;
        case 'pop':
          stack.pop();
          break;
        case 'replace':
          stack[stack.length - 1] = action.view;
          break;
        case 'quit':
          return;
      }
    } catch (err) {
      console.error('View error:', err);
      return;
    }
  }
}
