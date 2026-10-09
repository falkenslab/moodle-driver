import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    // A library: it never prints (a program's stdout may be a protocol, as an MCP server's is).
    files: ["src/**/*.ts"],
    rules: { "no-console": "error" },
  },
);
