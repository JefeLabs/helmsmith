import { describe, expect, it } from 'vitest';
import { isAdminMember } from './slash.js';

const ADMIN = '111111111111111111';

describe('isAdminMember', () => {
  it('allows a member holding the admin role', () => {
    expect(
      isAdminMember({ hasAdminPermission: false, roleIds: [ADMIN, '222'], adminRoleId: ADMIN }),
    ).toBe(true);
  });
  it('allows anyone with the Administrator permission', () => {
    expect(isAdminMember({ hasAdminPermission: true, roleIds: [], adminRoleId: ADMIN })).toBe(true);
  });
  it('denies a member without the role or permission', () => {
    expect(isAdminMember({ hasAdminPermission: false, roleIds: ['333'], adminRoleId: ADMIN })).toBe(
      false,
    );
  });
});
