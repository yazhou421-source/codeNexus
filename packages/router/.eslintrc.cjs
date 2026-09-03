const tsParser = require.resolve("@typescript-eslint/parser");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  globals: {
    AbortController: "readonly",
    fetch: "readonly",
    Response: "readonly",
    TextDecoder: "readonly",
    URL: "readonly",
  },
  ignorePatterns: ["dist/", "node_modules/"],
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^(?:_|model$|role$|hasRunnableToolCall$)",
        varsIgnorePattern: "^(?:_|requestHasResponseToolOutput$)",
        ignoreRestSiblings: true,
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.ts"],
      parser: tsParser,
      plugins: ["@typescript-eslint", "unused-imports"],
      rules: {
        "no-undef": "off",
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            ignoreRestSiblings: true,
          },
        ],
        "unused-imports/no-unused-imports": "error",
        "unused-imports/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            ignoreRestSiblings: true,
          },
        ],
      },
    },
  ],
};
