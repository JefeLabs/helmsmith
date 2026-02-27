import { describe, it, expect } from "vitest";
import { classifyFile, type FileType } from "../collector/classifier.js";

describe("classifyFile", () => {
  // ── Storybook (Priority 1) ─────────────────────────────────────────────────

  describe("storybook files", () => {
    it("classifies .stories.tsx files", () => {
      expect(classifyFile("src/Button.stories.tsx")).toBe("storybook");
    });

    it("classifies .stories.ts files", () => {
      expect(classifyFile("src/Button.stories.ts")).toBe("storybook");
    });

    it("classifies .stories.js files", () => {
      expect(classifyFile("components/Card.stories.js")).toBe("storybook");
    });

    it("classifies .story.tsx files", () => {
      expect(classifyFile("src/Input.story.tsx")).toBe("storybook");
    });

    it("classifies .story.js files", () => {
      expect(classifyFile("src/Input.story.js")).toBe("storybook");
    });

    it("classifies files inside .storybook/ directory", () => {
      expect(classifyFile(".storybook/main.ts")).toBe("storybook");
    });

    it("classifies .storybook/preview.js", () => {
      expect(classifyFile(".storybook/preview.js")).toBe("storybook");
    });

    it("classifies .mdx files in storybook paths", () => {
      expect(classifyFile("src/stories/Button.mdx")).toBe("storybook");
    });

    it("does NOT classify .mdx files outside storybook paths as storybook", () => {
      expect(classifyFile("docs/guide.mdx")).toBe("app");
    });
  });

  // ── Test (Priority 2) ──────────────────────────────────────────────────────

  describe("test files", () => {
    it("classifies .test.ts files", () => {
      expect(classifyFile("src/utils.test.ts")).toBe("test");
    });

    it("classifies .test.tsx files", () => {
      expect(classifyFile("src/App.test.tsx")).toBe("test");
    });

    it("classifies .test.js files", () => {
      expect(classifyFile("lib/helper.test.js")).toBe("test");
    });

    it("classifies .spec.ts files", () => {
      expect(classifyFile("src/utils.spec.ts")).toBe("test");
    });

    it("classifies .spec.tsx files", () => {
      expect(classifyFile("src/App.spec.tsx")).toBe("test");
    });

    it("classifies .cy.ts files", () => {
      expect(classifyFile("e2e/login.cy.ts")).toBe("test");
    });

    it("classifies .e2e.ts files", () => {
      expect(classifyFile("tests/checkout.e2e.ts")).toBe("test");
    });

    it("classifies files inside __tests__/ directory", () => {
      expect(classifyFile("src/__tests__/utils.ts")).toBe("test");
    });

    it("classifies files inside /test/ directory", () => {
      expect(classifyFile("src/test/helper.ts")).toBe("test");
    });

    it("classifies files inside /tests/ directory", () => {
      expect(classifyFile("src/tests/helper.ts")).toBe("test");
    });

    it("classifies vitest.config.ts", () => {
      expect(classifyFile("vitest.config.ts")).toBe("test");
    });

    it("classifies jest.config.js", () => {
      expect(classifyFile("jest.config.js")).toBe("test");
    });

    it("classifies files inside cypress/ directory", () => {
      expect(classifyFile("cypress/integration/login.ts")).toBe("test");
    });

    it("classifies files inside playwright/ directory", () => {
      expect(classifyFile("playwright/tests/checkout.ts")).toBe("test");
    });
  });

  // ── Config (Priority 3) ────────────────────────────────────────────────────

  describe("config files", () => {
    it("classifies .config.ts files", () => {
      expect(classifyFile("tailwind.config.ts")).toBe("config");
    });

    it("classifies .config.js files", () => {
      expect(classifyFile("eslint.config.js")).toBe("config");
    });

    it("classifies .json files", () => {
      expect(classifyFile("package.json")).toBe("config");
    });

    it("classifies tsconfig.json", () => {
      expect(classifyFile("tsconfig.json")).toBe("config");
    });

    it("classifies .yml files", () => {
      expect(classifyFile("config.yml")).toBe("config");
    });

    it("classifies .yaml files", () => {
      expect(classifyFile("docker-compose.yaml")).toBe("config");
    });

    it("classifies .toml files", () => {
      expect(classifyFile("pyproject.toml")).toBe("config");
    });

    it("classifies .env files", () => {
      expect(classifyFile(".env")).toBe("config");
    });

    it("classifies .env.local files", () => {
      expect(classifyFile(".env.local")).toBe("config");
    });

    it("classifies .env.production files", () => {
      expect(classifyFile(".env.production")).toBe("config");
    });

    it("classifies Dockerfile", () => {
      expect(classifyFile("Dockerfile")).toBe("config");
    });

    it("classifies Dockerfile.dev", () => {
      expect(classifyFile("Dockerfile.dev")).toBe("config");
    });

    it("classifies docker-compose.yml", () => {
      expect(classifyFile("docker-compose.yml")).toBe("config");
    });

    it("classifies files inside .github/ directory", () => {
      expect(classifyFile(".github/workflows/ci.yml")).toBe("config");
    });

    it("classifies .lock files", () => {
      expect(classifyFile("package-lock.json")).toBe("config");
    });

    it("classifies yarn.lock", () => {
      expect(classifyFile("yarn.lock")).toBe("config");
    });

    it("classifies Makefile", () => {
      expect(classifyFile("Makefile")).toBe("config");
    });

    it("classifies .eslintrc files", () => {
      expect(classifyFile(".eslintrc")).toBe("config");
    });

    it("classifies .eslintrc.js", () => {
      expect(classifyFile(".eslintrc.js")).toBe("config");
    });

    it("classifies .prettierrc", () => {
      expect(classifyFile(".prettierrc")).toBe("config");
    });

    it("classifies .prettierrc.json", () => {
      expect(classifyFile(".prettierrc.json")).toBe("config");
    });

    it("classifies tsconfig.base.json", () => {
      expect(classifyFile("tsconfig.base.json")).toBe("config");
    });

    it("classifies webpack.config.js", () => {
      expect(classifyFile("webpack.config.js")).toBe("config");
    });

    it("classifies vite.config.ts", () => {
      expect(classifyFile("vite.config.ts")).toBe("config");
    });
  });

  // ── App (Priority 4 — everything else) ─────────────────────────────────────

  describe("app files (default)", () => {
    it("classifies .ts files as app", () => {
      expect(classifyFile("src/index.ts")).toBe("app");
    });

    it("classifies .tsx files as app", () => {
      expect(classifyFile("src/App.tsx")).toBe("app");
    });

    it("classifies .js files as app", () => {
      expect(classifyFile("src/utils.js")).toBe("app");
    });

    it("classifies .jsx files as app", () => {
      expect(classifyFile("src/Component.jsx")).toBe("app");
    });

    it("classifies .py files as app", () => {
      expect(classifyFile("src/main.py")).toBe("app");
    });

    it("classifies .go files as app", () => {
      expect(classifyFile("cmd/server.go")).toBe("app");
    });

    it("classifies .rs files as app", () => {
      expect(classifyFile("src/lib.rs")).toBe("app");
    });

    it("classifies .css files as app", () => {
      expect(classifyFile("src/styles.css")).toBe("app");
    });

    it("classifies .scss files as app", () => {
      expect(classifyFile("src/styles.scss")).toBe("app");
    });

    it("classifies .html files as app", () => {
      expect(classifyFile("public/index.html")).toBe("app");
    });

    it("classifies .md files as app", () => {
      expect(classifyFile("README.md")).toBe("app");
    });

    it("classifies .sql files as app", () => {
      expect(classifyFile("migrations/001.sql")).toBe("app");
    });

    it("classifies .graphql files as app", () => {
      expect(classifyFile("schema.graphql")).toBe("app");
    });
  });

  // ── Priority ordering ──────────────────────────────────────────────────────

  describe("priority ordering (first match wins)", () => {
    it("classifies .stories.test.tsx as storybook (not test)", () => {
      expect(classifyFile("src/Button.stories.test.tsx")).toBe("storybook");
    });

    it("classifies .stories.spec.tsx as storybook (not test)", () => {
      expect(classifyFile("src/Button.stories.spec.tsx")).toBe("storybook");
    });

    it("classifies story in __tests__ as storybook (not test)", () => {
      expect(classifyFile("src/__tests__/Button.stories.tsx")).toBe("storybook");
    });

    it("classifies test file inside cypress/ as test (not config)", () => {
      expect(classifyFile("cypress/support/commands.ts")).toBe("test");
    });

    it("classifies vitest.config.ts as test (not config)", () => {
      // vitest.config matches test before .config matches config
      expect(classifyFile("vitest.config.ts")).toBe("test");
    });

    it("classifies jest.config.js as test (not config)", () => {
      expect(classifyFile("jest.config.js")).toBe("test");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles deeply nested paths", () => {
      expect(
        classifyFile("packages/ui/src/components/Button/Button.tsx")
      ).toBe("app");
    });

    it("handles paths with Windows-style separators", () => {
      expect(classifyFile("src\\__tests__\\utils.ts")).toBe("test");
    });

    it("handles uppercase extensions", () => {
      expect(classifyFile("src/Button.Stories.tsx")).toBe("storybook");
    });

    it("handles empty basename edge case", () => {
      expect(classifyFile("src/something.ts")).toBe("app");
    });

    it("classifies docker-compose.override.yml as config", () => {
      expect(classifyFile("docker-compose.override.yml")).toBe("config");
    });

    it("classifies pnpm-lock.yaml as config", () => {
      expect(classifyFile("pnpm-lock.yaml")).toBe("config");
    });
  });
});
