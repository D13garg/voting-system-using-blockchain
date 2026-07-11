// Shared base ESLint flat config. Each package (contracts/backend/frontend)
// extends this with its own environment-specific rules (e.g., frontend adds
// React plugin rules, backend adds Node-specific globals).
//
// Rationale for strictness here: this project follows the rule "never
// generate prototype-quality code" — `no-explicit-any` and
// `no-floating-promises` in particular catch the two most common sources of
// silent bugs in a TypeScript + async/blockchain codebase (unhandled
// promise rejections from contract calls are a real, recurring failure
// mode if left unchecked).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
    ignores: ["dist/**", "build/**", "artifacts/**", "cache/**", "typechain-types/**"],
  },
];
