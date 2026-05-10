/**
 * Focus subsystem — public API.
 *
 *   <FocusManager>          root provider that owns focus state
 *   useFocus(id, order?)    register + read isFocused
 *   useFocusController()    imperative next/prev/request
 *
 * The manager is centralized: one provider tracks all focusables in
 * registration order. Components are unaware of each other; they
 * just call useFocus(id) and react to isFocused changes.
 */

export { FocusManager, useFocus, useFocusController } from "./manager.tsx";
export type { FocusManagerProps, UseFocusResult } from "./manager.tsx";
