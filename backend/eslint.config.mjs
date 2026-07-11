// Backend-specific ESLint flat config. Extends the shared base
// (eslint.config.base.mjs) and adds:
// - parserOptions.project, pointing at this package's own tsconfig.json,
//   which type-aware rules (no-floating-promises, etc, via
//   recommendedTypeChecked in the base config) require to resolve type
//   information per file.
// - Node.js globals (process, __dirname, etc) since this is a server-side
//   package, not a browser one.
//
// IMPORTANT: type-aware linting (parserOptions.project) only applies to
// files actually covered by tsconfig.json's `include` (src/**, worker/**).
// Files outside that scope (test/, vitest.config.ts, this very
// eslint.config.mjs file) are matched separately below with type-checking
// disabled - attempting to type-check a file with no corresponding
// tsconfig project entry is a hard parsing error, not a lint warning.
import globals from "globals";
import tseslint from "typescript-eslint";
import baseConfig from "../eslint.config.base.mjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...baseConfig.map((config) => ({
    ...config,
    files: config.files ?? ["src/**/*.ts", "worker/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "worker/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Files genuinely outside the TS project's include scope: linted with
    // plain (non-type-aware) TypeScript rules only. No
    // recommendedTypeChecked, no parserOptions.project - those require a
    // tsconfig entry that deliberately doesn't exist for these files.
    //
    // NOTE: languageOptions.parser is still set explicitly here (to
    // tseslint.parser, WITHOUT parserOptions.project) - without it, these
    // files fall back to ESLint's default JS parser (espree), which
    // cannot parse TypeScript-only syntax at all (type annotations,
    // `import type`, inline `type` import modifiers) and fails with a
    // raw "Parsing error: Unexpected token" rather than a lint finding.
    // This was a real, silent gap: any test file using only plain-JS-
    // compatible syntax (no type annotations at all) passed lint by
    // accident, while one using ordinary TypeScript syntax would have
    // hard-failed to parse. Caught by test/integration/harness.ts, which
    // uses real type annotations and inline `type` import modifiers - see
    // HANDOFF.md's Phase 3 section for the isolated repro that confirmed
    // this before the fix.
    files: ["test/**/*.ts", "vitest.config.ts", "vitest.integration.config.ts", "*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.node,
      },
    },
    plugins: tseslint.configs.recommended[0].plugins,
    rules: {
      ...tseslint.configs.recommended[1].rules,
    },
  },
];