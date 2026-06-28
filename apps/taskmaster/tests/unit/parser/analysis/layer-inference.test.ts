import { describe, expect, it } from 'vitest';
import {
  inferLayer,
  inferLayerFromAST,
  inferLayerFromPath,
} from '../../../../src/parser/analysis/layer-inference.js';

// --- Helper to build mock tree-sitter nodes ---

interface MockNode {
  type: string;
  text: string;
  children: MockNode[];
  namedChildren: MockNode[];
}

function makeNode(type: string, text: string, children: MockNode[] = []): MockNode {
  return { type, text, children, namedChildren: children };
}

function makeRoot(...children: MockNode[]): MockNode {
  return makeNode('program', '', children);
}

// ===================================================================
// Path-based inference
// ===================================================================

describe('inferLayerFromPath', () => {
  // --- tests ---

  it('detects tests/ directory', () => {
    expect(inferLayerFromPath('tests/unit/foo.test.ts')).toBe('tests');
  });

  it('detects __tests__ directory', () => {
    expect(inferLayerFromPath('src/__tests__/bar.ts')).toBe('tests');
  });

  it('detects .spec. in basename', () => {
    expect(inferLayerFromPath('foo.spec.js')).toBe('tests');
  });

  it('detects .test. in basename', () => {
    expect(inferLayerFromPath('components/button.test.tsx')).toBe('tests');
  });

  // --- scripts ---

  it('detects scripts/ directory', () => {
    expect(inferLayerFromPath('scripts/deploy.sh')).toBe('scripts');
  });

  it('detects Makefile', () => {
    expect(inferLayerFromPath('Makefile')).toBe('scripts');
  });

  it('detects .bash extension', () => {
    expect(inferLayerFromPath('deploy.bash')).toBe('scripts');
  });

  it('detects .sh extension', () => {
    expect(inferLayerFromPath('run.sh')).toBe('scripts');
  });

  it('detects Taskfile prefix', () => {
    expect(inferLayerFromPath('Taskfile.yml')).toBe('scripts');
  });

  it('detects justfile', () => {
    expect(inferLayerFromPath('justfile')).toBe('scripts');
  });

  // --- cli ---

  it('detects cmd/ directory', () => {
    expect(inferLayerFromPath('src/cmd/main.go')).toBe('cli');
  });

  it('detects cli/ directory', () => {
    expect(inferLayerFromPath('src/cli/index.ts')).toBe('cli');
  });

  it('detects bin/ directory', () => {
    expect(inferLayerFromPath('bin/agentx.js')).toBe('cli');
  });

  // --- api ---

  it('detects routes/ directory', () => {
    expect(inferLayerFromPath('src/routes/users.ts')).toBe('api');
  });

  it('detects controllers/ directory', () => {
    expect(inferLayerFromPath('src/controllers/auth.ts')).toBe('api');
  });

  it('detects handlers/ directory', () => {
    expect(inferLayerFromPath('src/handlers/webhook.ts')).toBe('api');
  });

  it('detects api/ directory', () => {
    expect(inferLayerFromPath('src/api/v1/endpoints.ts')).toBe('api');
  });

  it('detects endpoints/ directory', () => {
    expect(inferLayerFromPath('src/endpoints/health.ts')).toBe('api');
  });

  // --- service ---

  it('detects services/ directory', () => {
    expect(inferLayerFromPath('src/services/auth-service.ts')).toBe('service');
  });

  it('detects usecases/ directory', () => {
    expect(inferLayerFromPath('src/usecases/create-order.ts')).toBe('service');
  });

  it('detects workflows/ directory', () => {
    expect(inferLayerFromPath('src/workflows/onboarding.ts')).toBe('service');
  });

  // --- domain ---

  it('detects domain/ directory', () => {
    expect(inferLayerFromPath('src/domain/user.ts')).toBe('domain');
  });

  it('detects models/ directory', () => {
    expect(inferLayerFromPath('src/models/product.ts')).toBe('domain');
  });

  it('detects entities/ directory', () => {
    expect(inferLayerFromPath('src/entities/order.ts')).toBe('domain');
  });

  it('detects core/ directory', () => {
    expect(inferLayerFromPath('src/core/engine.ts')).toBe('domain');
  });

  // --- data ---

  it('detects repositories/ directory', () => {
    expect(inferLayerFromPath('src/repositories/user-repo.ts')).toBe('data');
  });

  it('detects migrations/ directory', () => {
    expect(inferLayerFromPath('src/migrations/001_init.ts')).toBe('data');
  });

  it('detects db/ directory', () => {
    expect(inferLayerFromPath('src/db/connection.ts')).toBe('data');
  });

  it('detects dao/ directory', () => {
    expect(inferLayerFromPath('src/dao/product-dao.ts')).toBe('data');
  });

  it('detects data/ directory', () => {
    expect(inferLayerFromPath('src/data/seed.ts')).toBe('data');
  });

  it('detects queries/ directory', () => {
    expect(inferLayerFromPath('src/queries/user-queries.ts')).toBe('data');
  });

  it('detects repo/ directory', () => {
    expect(inferLayerFromPath('src/repo/cache.ts')).toBe('data');
  });

  // --- infra ---

  it('detects config/ directory', () => {
    expect(inferLayerFromPath('src/config/settings.ts')).toBe('infra');
  });

  it('detects auth/ directory', () => {
    expect(inferLayerFromPath('src/auth/login.ts')).toBe('infra');
  });

  it('detects utils/ directory', () => {
    expect(inferLayerFromPath('src/utils/logger.ts')).toBe('infra');
  });

  it('detects adapters/ directory', () => {
    expect(inferLayerFromPath('src/adapters/redis.ts')).toBe('infra');
  });

  it('detects lib/ directory', () => {
    expect(inferLayerFromPath('src/lib/helpers.ts')).toBe('infra');
  });

  it('detects infra/ directory', () => {
    expect(inferLayerFromPath('src/infra/messaging.ts')).toBe('infra');
  });

  it('detects clients/ directory', () => {
    expect(inferLayerFromPath('src/clients/http.ts')).toBe('infra');
  });

  it('detects logging/ directory', () => {
    expect(inferLayerFromPath('src/logging/winston.ts')).toBe('infra');
  });

  // --- default ---

  it('defaults to infra for unrecognised paths', () => {
    expect(inferLayerFromPath('src/parser/foo.ts')).toBe('infra');
  });

  it('defaults to infra for a top-level file', () => {
    expect(inferLayerFromPath('index.ts')).toBe('infra');
  });

  // --- edge cases ---

  it('handles Windows-style backslash separators', () => {
    expect(inferLayerFromPath('src\\routes\\users.ts')).toBe('api');
  });

  it('tests rule takes priority over scripts rule for test scripts', () => {
    // A test file inside a scripts-like path should still be tests
    // because tests rule is checked first
    expect(inferLayerFromPath('tests/scripts/deploy.test.ts')).toBe('tests');
  });
});

// ===================================================================
// AST-based inference
// ===================================================================

describe('inferLayerFromAST', () => {
  // --- API / Route patterns ---

  it('detects app.get() as api', () => {
    const root = makeRoot(makeNode('expression_statement', "app.get('/api/users', handler)"));
    expect(inferLayerFromAST(root, 'typescript', 'src/server.ts')).toBe('api');
  });

  it('detects app.post() as api', () => {
    const root = makeRoot(makeNode('call_expression', "app.post('/api/users', handler)"));
    expect(inferLayerFromAST(root, 'typescript', 'src/server.ts')).toBe('api');
  });

  it('detects router.put() as api', () => {
    const root = makeRoot(makeNode('call_expression', "router.put('/api/items/:id', handler)"));
    expect(inferLayerFromAST(root, 'typescript', 'src/routes.ts')).toBe('api');
  });

  it('detects router.delete() as api', () => {
    const root = makeRoot(makeNode('expression_statement', "router.delete('/items/:id', handler)"));
    expect(inferLayerFromAST(root, 'typescript', 'src/routes.ts')).toBe('api');
  });

  it('detects app.use() as api', () => {
    const root = makeRoot(makeNode('call_expression', "app.use('/api', apiRouter)"));
    expect(inferLayerFromAST(root, 'typescript', 'src/app.ts')).toBe('api');
  });

  // --- Test patterns ---

  it('detects describe() as tests', () => {
    const root = makeRoot(makeNode('expression_statement', "describe('my test suite', () => {})"));
    expect(inferLayerFromAST(root, 'typescript', 'src/foo.ts')).toBe('tests');
  });

  it('detects it() as tests', () => {
    const root = makeRoot(makeNode('call_expression', "it('should work', () => {})"));
    expect(inferLayerFromAST(root, 'typescript', 'src/foo.ts')).toBe('tests');
  });

  it('detects test() as tests', () => {
    const root = makeRoot(makeNode('call_expression', "test('adds 1 + 2', () => {})"));
    expect(inferLayerFromAST(root, 'typescript', 'src/foo.ts')).toBe('tests');
  });

  it('detects Go Test function as tests', () => {
    const root = makeRoot(makeNode('function_declaration', 'func TestAddition(t *testing.T) {}'));
    expect(inferLayerFromAST(root, 'go', 'add_test.go')).toBe('tests');
  });

  it('detects Rust #[test] attribute as tests', () => {
    const root = makeRoot(makeNode('attribute_item', '#[test]'));
    expect(inferLayerFromAST(root, 'rust', 'src/lib.rs')).toBe('tests');
  });

  // --- CLI patterns ---

  it('detects new Command() as cli', () => {
    const root = makeRoot(makeNode('new_expression', "new Command('serve')"));
    expect(inferLayerFromAST(root, 'typescript', 'src/cli.ts')).toBe('cli');
  });

  it('detects program.command() as cli', () => {
    const root = makeRoot(makeNode('call_expression', "program.command('init')"));
    expect(inferLayerFromAST(root, 'typescript', 'src/main.ts')).toBe('cli');
  });

  it('detects program.parse() as cli', () => {
    const root = makeRoot(makeNode('expression_statement', 'program.parse(process.argv)'));
    expect(inferLayerFromAST(root, 'typescript', 'bin/index.ts')).toBe('cli');
  });

  it('detects argparse import as cli', () => {
    const root = makeRoot(makeNode('import_statement', "import argparse from 'argparse'"));
    expect(inferLayerFromAST(root, 'typescript', 'src/cli.ts')).toBe('cli');
  });

  // --- Nested detection (one level deep into namedChildren) ---

  it('detects patterns in namedChildren', () => {
    const inner = makeNode('call_expression', "describe('nested', () => {})");
    const outer = makeNode('expression_statement', 'wrapper', [inner]);
    const root = makeRoot(outer);
    expect(inferLayerFromAST(root, 'typescript', 'src/foo.ts')).toBe('tests');
  });

  // --- No match ---

  it('returns null when no AST signal is found', () => {
    const root = makeRoot(makeNode('lexical_declaration', 'const x = 42'));
    expect(inferLayerFromAST(root, 'typescript', 'src/foo.ts')).toBeNull();
  });

  it('returns null for null rootNode', () => {
    expect(inferLayerFromAST(null, 'typescript', 'src/foo.ts')).toBeNull();
  });

  it('returns null for undefined rootNode', () => {
    expect(inferLayerFromAST(undefined, 'typescript', 'src/foo.ts')).toBeNull();
  });

  it('returns null for rootNode with no children', () => {
    const root = { type: 'program', text: '', children: [], namedChildren: [] };
    expect(inferLayerFromAST(root, 'typescript', 'src/foo.ts')).toBeNull();
  });
});

// ===================================================================
// Combined inference (inferLayer)
// ===================================================================

describe('inferLayer', () => {
  it('uses AST result when AST detects a layer', () => {
    // Path says "infra" (src/parser/foo.ts), but AST says "api"
    const root = makeRoot(makeNode('call_expression', "app.get('/users', handler)"));
    expect(inferLayer('src/parser/foo.ts', root, 'typescript')).toBe('api');
  });

  it('falls back to path when AST returns null', () => {
    const root = makeRoot(makeNode('lexical_declaration', 'const x = 42'));
    expect(inferLayer('src/routes/users.ts', root, 'typescript')).toBe('api');
  });

  it('falls back to path when no rootNode is provided', () => {
    expect(inferLayer('src/services/auth.ts')).toBe('service');
  });

  it('falls back to path when rootNode is undefined', () => {
    expect(inferLayer('src/models/user.ts', undefined, undefined)).toBe('domain');
  });

  it('AST test detection overrides path-based infra', () => {
    const root = makeRoot(makeNode('call_expression', "describe('suite', () => {})"));
    expect(inferLayer('src/utils/helper.ts', root, 'typescript')).toBe('tests');
  });

  it('AST cli detection overrides path-based default', () => {
    const root = makeRoot(makeNode('new_expression', "new Command('run')"));
    expect(inferLayer('src/main.ts', root, 'typescript')).toBe('cli');
  });
});
