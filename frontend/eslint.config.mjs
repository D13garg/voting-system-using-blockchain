// Frontend-specific ESLint flat config. Extends the shared base and adds
// React-specific rules (hooks correctness, Vite's react-refresh
// constraints) plus browser globals instead of Node globals.
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import baseConfig from "../eslint.config.base.mjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...baseConfig.map((config) => ({
    ...config,
    files: config.files ?? ["src/**/*.ts", "src/**/*.tsx"],
  })),
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // vite.config.ts, tailwind.config.js, postcss.config.js live outside
    // tsconfig.json's "src" include scope and run in a Node context
    // (build tooling), not a browser one - same type-aware-scope
    // boundary issue as backend/contracts, same fix.
    files: ["vite.config.ts", "tailwind.config.js", "postcss.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
