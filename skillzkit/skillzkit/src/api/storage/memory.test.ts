import { describe, expect, it } from 'vitest';
import type { AuthorIdentity, Command, Skill, Workflow } from '../contracts.js';
import { AuthorMismatchError, VersionConflictError, VersionNotFoundError } from './interface.js';
import { MemoryCatalogStorage } from './memory.js';

const alice: AuthorIdentity = {
  id: 'u_alice',
  displayName: 'Alice',
  email: 'alice@example.com',
};
const bob: AuthorIdentity = {
  id: 'u_bob',
  displayName: 'Bob',
  email: 'bob@example.com',
};

function makeCommand(slug: string, body = 'body'): Command {
  return {
    slug,
    path: `${slug.replace(/:/g, '/')}.md`,
    kind: 'command',
    description: `desc for ${slug}`,
    references: [],
    referencedBy: [],
    body,
    frontmatter: {},
  };
}

function makeSkill(name: string): Skill {
  return {
    name,
    path: `${name}/SKILL.md`,
    description: `skill ${name}`,
    references: [],
    body: 'body',
    frontmatter: {},
  };
}

function makeWorkflow(qualifiedName: string): Workflow {
  const [domain, slug] = qualifiedName.split(':');
  return {
    qualifiedName,
    domain,
    slug,
    commandSlug: `${domain}:workflows:${slug}`,
    description: `wf ${qualifiedName}`,
    references: [],
    body: 'body',
    frontmatter: {},
  };
}

describe('MemoryCatalogStorage — basic put/get', () => {
  it('returns null for unknown slugs', async () => {
    const s = new MemoryCatalogStorage();
    expect(await s.getCommand('nope')).toBe(null);
    expect(await s.getSkill('nope')).toBe(null);
    expect(await s.getWorkflow('nope:nope')).toBe(null);
  });

  it('put then get specific version returns the artifact', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    expect(await s.getCommandVersion('foo', '1.0.0')).toMatchObject({
      slug: 'foo',
    });
  });

  it('a fresh put lands as unpromoted; getCommand returns null until promote', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    expect(await s.getCommand('foo')).toBe(null);
    await s.promoteCommand('foo', '1.0.0');
    expect(await s.getCommand('foo')).toMatchObject({ slug: 'foo' });
  });
});

describe('MemoryCatalogStorage — version invariants', () => {
  it('rejects republishing the same version (versions are immutable)', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    await expect(
      s.putCommand({
        command: makeCommand('foo', 'different body'),
        version: '1.0.0',
        author: alice,
      }),
    ).rejects.toThrow(VersionConflictError);
  });

  it('allows author of record to publish additional versions', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.1.0',
      author: alice,
    });
    const versions = await s.listCommandVersions('foo');
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version)).toEqual(['1.0.0', '1.1.0']);
  });

  it("rejects a different author trying to update another author's slug", async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    await expect(
      s.putCommand({
        command: makeCommand('foo'),
        version: '2.0.0',
        author: bob,
      }),
    ).rejects.toThrow(AuthorMismatchError);
  });

  it('author check uses stable id, not display name', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    // Same id, different display name + email — should be allowed
    const aliceRenamed: AuthorIdentity = {
      id: alice.id,
      displayName: 'Alice (changed)',
      email: 'alice2@example.com',
    };
    await expect(
      s.putCommand({
        command: makeCommand('foo'),
        version: '1.1.0',
        author: aliceRenamed,
      }),
    ).resolves.toBeDefined();
  });
});

describe('MemoryCatalogStorage — promotion', () => {
  it('promote moves the pointer; only one version is current at a time', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo', 'v1'),
      version: '1.0.0',
      author: alice,
    });
    await s.putCommand({
      command: makeCommand('foo', 'v2'),
      version: '1.1.0',
      author: alice,
    });

    await s.promoteCommand('foo', '1.0.0');
    expect((await s.getCommand('foo'))?.body).toBe('v1');

    await s.promoteCommand('foo', '1.1.0');
    expect((await s.getCommand('foo'))?.body).toBe('v2');

    const versions = await s.listCommandVersions('foo');
    const promotedFlags = versions.map((v) => v.promoted);
    expect(promotedFlags).toEqual([false, true]);
  });

  it('promote throws on unknown version', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    await expect(s.promoteCommand('foo', '9.9.9')).rejects.toThrow(VersionNotFoundError);
    await expect(s.promoteCommand('nope', '1.0.0')).rejects.toThrow(VersionNotFoundError);
  });
});

describe('MemoryCatalogStorage — index', () => {
  it('excludes unpromoted entries from the index', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo'),
      version: '1.0.0',
      author: alice,
    });
    let index = await s.getIndex();
    expect(index.commands).toHaveLength(0);

    await s.promoteCommand('foo', '1.0.0');
    index = await s.getIndex();
    expect(index.commands).toHaveLength(1);
    expect(index.commands[0].slug).toBe('foo');
  });

  it('index summaries strip the body field', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('foo', 'this body should not be in the index'),
      version: '1.0.0',
      author: alice,
    });
    await s.promoteCommand('foo', '1.0.0');
    const index = await s.getIndex();
    expect(index.commands[0]).not.toHaveProperty('body');
  });

  it('includes commands, skills, and workflows independently', async () => {
    const s = new MemoryCatalogStorage();
    await s.putCommand({
      command: makeCommand('a'),
      version: '1',
      author: alice,
    });
    await s.putSkill({
      skill: makeSkill('router-x'),
      version: '1',
      author: alice,
    });
    await s.putWorkflow({
      workflow: makeWorkflow('product:greenfield'),
      version: '1',
      author: alice,
    });
    await s.promoteCommand('a', '1');
    await s.promoteSkill('router-x', '1');
    await s.promoteWorkflow('product:greenfield', '1');

    const index = await s.getIndex();
    expect(index.commands).toHaveLength(1);
    expect(index.skills).toHaveLength(1);
    expect(index.workflows).toHaveLength(1);
  });
});
