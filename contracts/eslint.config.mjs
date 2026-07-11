// Contracts-package ESLint flat config. Mirrors backend/eslint.config.mjs's
// approach: type-aware linting only for files actually covered by this
// package's tsconfig.json (scripts/, test/, hardhat.config.ts per
// tsconfig.json's include array) - attempting to type-check anything
// outside that scope is a parsing error, not a lint finding.
//
// Solidity files (contracts/*.sol) are NOT linted by this config - ESLint
// lints JS/TS, not Solidity. Solidity-specific static analysis is Slither
// (deferred per the Phase 2 sign-off) or a dedicated Solidity linter
// (solhint), neither of which is wired up yet.
import globals from "globals";
import tseslint from "typescript-eslint";
import baseConfig from "../eslint.config.base.mjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "artifacts/**", "cache/**", "coverage/**"],
  },
  ...baseConfig.map((config) => ({
    ...config,
    files: config.files ?? ["scripts/**/*.ts", "test/**/*.ts", "hardhat.config.ts"],
  })),
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "hardhat.config.ts"],
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
    // CLI scripts (deploy, verify, extract-abi) legitimately print
    // progress/status to the console as their primary UX - this is not
    // debug-statement leftovers the base config's no-console rule is
    // meant to catch, so it's relaxed specifically for this directory.
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // scripts/ and test/ both call `ethers.getContractFactory("Name")`
    // (Hardhat's string-based factory lookup). In this Hardhat/ethers-v6/
    // TypeChain version combination that call's return type resolves to an
    // effectively-error/`any`-typed value - a real gap in Hardhat's own
    // ambient typing for this API, not a defect in this codebase. That
    // cascades into every `.connect(...)`, `.deploy(...)`, and role-getter
    // call made on the result being flagged by the no-unsafe-* family
    // below, producing hundreds of findings with zero real bugs among
    // them. Typed factory imports and `as unknown as X` casts were both
    // tried previously and either broke test execution or made lint worse.
    //
    // This scoped override turns off ONLY the no-unsafe-* family, and ONLY
    // for these two directories. Everything else stays on:
    // no-floating-promises (the rule that actually matters for a
    // blockchain-calling codebase - unhandled promise rejections), plus
    // no-explicit-any, no-unused-vars, eqeqeq. Real type errors are still
    // caught by `tsc --noEmit`, which does not have this false-positive
    // problem since it doesn't do the same call-signature-resolution
    // heuristics ESLint's type-aware rules do.
    files: ["scripts/**/*.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // verify-compile.cjs is a deliberate sandbox-verification workaround
    // (see its own header comment) using plain CJS require() - not part
    // of the project's real build/test path, and not worth bringing into
    // the strict TS-project-aware lint scope above.
    files: ["*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
    ...tseslint.configs.recommended[1],
  },
];
