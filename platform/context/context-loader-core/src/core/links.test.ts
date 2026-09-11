import { describe, expect, it } from 'vitest';
import { createLinkResolver, extractLinks, type LinkRef } from './links.ts';

describe('extractLinks', () => {
  it.each<[string, string, LinkRef[]]>([
    ['bare wikilink', 'See [[Alpha]].', [{ kind: 'wiki', target: 'Alpha' }]],
    [
      'wikilink with a path',
      'See [[projects/Alpha]].',
      [{ kind: 'wiki', target: 'projects/Alpha' }],
    ],
    ['surrounding whitespace is trimmed', 'See [[ Alpha ]].', [{ kind: 'wiki', target: 'Alpha' }]],
    ['alias is dropped', 'See [[Alpha|the alpha note]].', [{ kind: 'wiki', target: 'Alpha' }]],
    ['table-escaped alias pipe', '| [[Alpha\\|a]] |', [{ kind: 'wiki', target: 'Alpha' }]],
    ['heading subpath is dropped', 'See [[Alpha#Risks]].', [{ kind: 'wiki', target: 'Alpha' }]],
    ['block subpath is dropped', 'See [[Alpha#^b1]].', [{ kind: 'wiki', target: 'Alpha' }]],
    ['embed counts as a link', '![[Alpha]]', [{ kind: 'wiki', target: 'Alpha' }]],
    ['same-note heading link is not a note link', 'See [[#Risks]].', []],
    ['relative markdown link', 'See [b](../b.md).', [{ kind: 'markdown', target: '../b.md' }]],
    ['markdown anchor is dropped', 'See [b](b.md#part).', [{ kind: 'markdown', target: 'b.md' }]],
    ['markdown query is dropped', 'See [b](b.md?v=2).', [{ kind: 'markdown', target: 'b.md' }]],
    [
      'percent-encoded href is decoded',
      '[n](My%20Note.md)',
      [{ kind: 'markdown', target: 'My Note.md' }],
    ],
    [
      'malformed percent-encoding is kept verbatim',
      '[n](100%.md)',
      [{ kind: 'markdown', target: '100%.md' }],
    ],
    [
      'angle-bracket href keeps spaces',
      '[n](<My Note.md>)',
      [{ kind: 'markdown', target: 'My Note.md' }],
    ],
    ['external URLs are not note links', '[x](https://example.com) [m](mailto:a@b.co)', []],
    ['protocol-relative URL is not a note link', '[x](//cdn.example.com/a.md)', []],
    ['in-page anchor is not a note link', '[top](#top)', []],
    [
      'links inside fenced code are ignored',
      '```ts\nconst a = [[Alpha]];\nfn[0](b.md);\n```\n',
      [],
    ],
    ['links inside tilde fences are ignored', '~~~\n[[Alpha]]\n~~~\n', []],
    ['links inside inline code are ignored', 'Type `[[Alpha]]` to link.', []],
  ])('%s', (_name, md, want) => {
    expect(extractLinks(md)).toEqual(want);
  });

  it('keeps links on either side of a code fence', () => {
    const md = '[[Before]]\n\n```\n[[Hidden]]\n```\n\n[[After]]\n';
    expect(extractLinks(md).map((l) => l.target)).toEqual(['Before', 'After']);
  });
});

describe('createLinkResolver', () => {
  const vault = createLinkResolver([
    'index.md',
    'Note.md',
    'Plan.md',
    'projects/Plan.md',
    'projects/alpha.md',
    'projects/Log.md',
    'areas/health/Log.md',
    'areas/health/diet.md',
    'docs/setup.md',
    'docs/guide/setup.md',
    'shared.md',
    'Cafe\u0301.md', // decomposed (NFD), as macOS filesystems may report it
    'home/Todo.md',
    'work/Todo.md',
    'x/y/Idea.md',
    'someplace/Idea.md',
  ]);
  const wiki = (target: string): LinkRef => ({ kind: 'wiki', target });
  const md = (target: string): LinkRef => ({ kind: 'markdown', target });

  it.each<[string, string, LinkRef, string | null]>([
    [
      'a bare name resolves to the only note with that name',
      'index.md',
      wiki('alpha'),
      'projects/alpha.md',
    ],
    ['name matching ignores case', 'index.md', wiki('ALPHA'), 'projects/alpha.md'],
    ['an explicit extension still matches', 'index.md', wiki('alpha.md'), 'projects/alpha.md'],
    [
      'a vault-absolute path resolves directly',
      'index.md',
      wiki('projects/alpha'),
      'projects/alpha.md',
    ],
    [
      'a partial path disambiguates by suffix',
      'index.md',
      wiki('health/Log'),
      'areas/health/Log.md',
    ],
    ['a root-level note owns its bare name', 'areas/health/diet.md', wiki('Plan'), 'Plan.md'],
    ['suffixes only match whole path segments', 'index.md', wiki('jects/alpha'), null],
    ['an unknown name is unresolved', 'index.md', wiki('missing'), null],
    [
      'a relative wikilink resolves from the linking note',
      'projects/alpha.md',
      wiki('../Note'),
      'Note.md',
    ],
    [
      'a relative markdown link resolves from the linking note',
      'projects/alpha.md',
      md('../Note.md'),
      'Note.md',
    ],
    [
      'a markdown link prefers the sibling over namesakes',
      'docs/guide/index.md',
      md('setup.md'),
      'docs/guide/setup.md',
    ],
    [
      'a shortest-path markdown link falls back to the name lookup',
      'index.md',
      md('alpha.md'),
      'projects/alpha.md',
    ],
    [
      'a root-anchored markdown link resolves from the vault root',
      'projects/alpha.md',
      md('/Note.md'),
      'Note.md',
    ],
    [
      'a relative link that climbs out of the vault is unresolved',
      'index.md',
      md('../shared.md'),
      null,
    ],
    [
      'Unicode normalization form does not break a match',
      'index.md',
      wiki('Caf\u00e9'),
      'Cafe\u0301.md',
    ],
  ])('%s', (_name, from, ref, want) => {
    expect(vault.resolve(from, ref)).toBe(want);
  });

  // Several namesakes, none at the exact vault path: same folder as the
  // linking note first, then fewest folders deep, then alphabetical.
  it.each<[string, string, string, string]>([
    [
      'a namesake in the linking note’s folder wins',
      'areas/health/diet.md',
      'Log',
      'areas/health/Log.md',
    ],
    ['otherwise the namesake closest to the vault root wins', 'index.md', 'Log', 'projects/Log.md'],
    ['closeness counts folders, not characters', 'index.md', 'Idea', 'someplace/Idea.md'],
    [
      'same folder means that folder, not an ancestor',
      'areas/health/sub/x.md',
      'Log',
      'projects/Log.md',
    ],
    ['equally close namesakes resolve alphabetically', 'index.md', 'Todo', 'home/Todo.md'],
  ])('ambiguous: %s', (_name, from, target, want) => {
    expect(vault.resolve(from, wiki(target))).toBe(want);
  });
});
