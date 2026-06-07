import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".pnpm-store/**",
      ".git/**",
      ".devcontainer/**",
      "pnpm-lock.yaml",
      "*.log",
      "*.tsbuildinfo",
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
            allowDefaultProject: [
              "eslint.config.mjs",
              "vitest.config.ts",
              "test/*.ts",
              "test/integration/*.ts",
            ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
            allowDefaultProject: [
              "eslint.config.mjs",
              "vitest.config.ts",
              "test/*.ts",
              "test/integration/*.ts",
            ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },

    plugins: {
      unicorn,
      "import-x": importX,
    },

    rules: {
      // TypeScript strictness
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: false,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/no-import-type-side-effects": "error",

      // Code hygiene
      "no-console": [
        "warn",
        {
          allow: ["warn", "error", "info"],
        },
      ],
      "no-debugger": "error",
      "no-alert": "error",
      "no-duplicate-imports": "error",
      "object-shorthand": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "all"],

      // Import hygiene
      "import-x/first": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-cycle": "error",
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
      "import-x/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "type",
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      // General quality
      "unicorn/better-regex": "error",
      "unicorn/catch-error-name": "error",
      "unicorn/consistent-function-scoping": "error",
      "unicorn/error-message": "error",
      "unicorn/explicit-length-check": "error",
      "unicorn/new-for-builtins": "error",
      "unicorn/no-array-for-each": "off",
      "unicorn/no-null": "off",
      "unicorn/no-useless-undefined": "error",
      "unicorn/prefer-module": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-string-replace-all": "error",
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            args: true,
            env: true,
            dto: true,
            dtos: true,
            repo: true,
            repos: true,
            props: true,
          },
        },
      ],
    },
  },

  {
    files: ["eslint.config.mjs"],

    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    files: ["test/**/*.ts", "tests/**/*.ts"],

    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },

  prettierConfig,
);
