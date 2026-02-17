import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  isSupportedExtension,
  resolveGrammarPath,
  getSupportedExtensions,
} from '../../../../src/parser/analysis/grammars.js';

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
  });

  it('detects TSX', () => {
    expect(detectLanguage('App.tsx')).toBe('tsx');
  });

  it('detects JavaScript variants', () => {
    expect(detectLanguage('script.js')).toBe('javascript');
    expect(detectLanguage('script.jsx')).toBe('javascript');
    expect(detectLanguage('module.mjs')).toBe('javascript');
    expect(detectLanguage('require.cjs')).toBe('javascript');
  });

  it('detects Go', () => {
    expect(detectLanguage('main.go')).toBe('go');
  });

  it('detects Rust', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('detects Java', () => {
    expect(detectLanguage('App.java')).toBe('java');
  });

  it('detects C#', () => {
    expect(detectLanguage('Program.cs')).toBe('csharp');
  });

  it('detects Bash', () => {
    expect(detectLanguage('deploy.sh')).toBe('bash');
    expect(detectLanguage('setup.bash')).toBe('bash');
  });

  it('returns null for unsupported extensions', () => {
    expect(detectLanguage('data.json')).toBeNull();
    expect(detectLanguage('styles.css')).toBeNull();
    expect(detectLanguage('README.md')).toBeNull();
    expect(detectLanguage('file.py')).toBeNull();
  });
});

describe('isSupportedExtension', () => {
  it('returns true for supported files', () => {
    expect(isSupportedExtension('index.ts')).toBe(true);
    expect(isSupportedExtension('main.go')).toBe(true);
    expect(isSupportedExtension('lib.rs')).toBe(true);
    expect(isSupportedExtension('script.sh')).toBe(true);
  });

  it('returns false for unsupported files', () => {
    expect(isSupportedExtension('styles.css')).toBe(false);
    expect(isSupportedExtension('data.json')).toBe(false);
  });
});

describe('resolveGrammarPath', () => {
  it('resolves a WASM grammar path for typescript', () => {
    const path = resolveGrammarPath('typescript');
    expect(path).toContain('tree-sitter-typescript.wasm');
  });

  it('resolves a WASM grammar path for csharp', () => {
    const path = resolveGrammarPath('csharp');
    expect(path).toContain('tree-sitter-c_sharp.wasm');
  });

  it('resolves a WASM grammar path for bash', () => {
    const path = resolveGrammarPath('bash');
    expect(path).toContain('tree-sitter-bash.wasm');
  });
});

describe('getSupportedExtensions', () => {
  it('returns all mapped extensions', () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain('.ts');
    expect(exts).toContain('.tsx');
    expect(exts).toContain('.js');
    expect(exts).toContain('.go');
    expect(exts).toContain('.rs');
    expect(exts).toContain('.java');
    expect(exts).toContain('.cs');
    expect(exts).toContain('.sh');
  });
});
