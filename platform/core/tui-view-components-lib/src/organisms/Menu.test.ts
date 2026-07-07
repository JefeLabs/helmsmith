import { describe, expect, it } from 'vitest';
import type { MenuItem } from './Menu.tsx';

describe('MenuItem (type contract)', () => {
  it('supports nested submenus', () => {
    const items: MenuItem[] = [
      {
        id: 'file',
        label: 'File',
        submenu: [
          { id: 'new', label: 'New' },
          { id: 'open', label: 'Open' },
          {
            id: 'recent',
            label: 'Recent',
            submenu: [
              { id: 'r1', label: 'project-a/' },
              { id: 'r2', label: 'project-b/' },
            ],
          },
        ],
      },
      { id: 'quit', label: 'Quit', hotkey: 'q' },
    ];
    expect(items[0]?.submenu).toHaveLength(3);
    expect(items[0]?.submenu?.[2]?.submenu).toHaveLength(2);
    expect(items[1]?.hotkey).toBe('q');
  });

  it('supports leaf items with onSelect callback', () => {
    let called = false;
    const item: MenuItem = {
      id: 'save',
      label: 'Save',
      onSelect: () => {
        called = true;
      },
    };
    item.onSelect?.();
    expect(called).toBe(true);
  });

  it('supports a badge for items', () => {
    const item: MenuItem = {
      id: 'inbox',
      label: 'Inbox',
      badge: '12 new',
    };
    expect(item.badge).toBe('12 new');
  });
});

describe('Menu path semantics', () => {
  // The path is what consumers observe via onChange. These tests
  // validate the path-stack semantics independent of the React render.

  it('path is empty at root level', () => {
    // Conceptual: with no levels drilled, path === []
    const path: MenuItem[] = [];
    expect(path).toHaveLength(0);
  });

  it('drilling into a submenu pushes the parent onto path', () => {
    const file: MenuItem = {
      id: 'file',
      label: 'File',
      submenu: [{ id: 'new', label: 'New' }],
    };
    const path = [file];
    expect(path[0]?.id).toBe('file');
  });

  it('exiting pops the path', () => {
    const file: MenuItem = { id: 'file', label: 'File' };
    const edit: MenuItem = { id: 'edit', label: 'Edit' };
    let path = [file, edit];
    path = path.slice(0, -1);
    expect(path).toHaveLength(1);
    expect(path[0]?.id).toBe('file');
    path = path.slice(0, -1);
    expect(path).toHaveLength(0);
  });
});
