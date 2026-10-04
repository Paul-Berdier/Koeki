import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  // pnpm keeps Next's ESLint plugins beside their declaring package.
  resolvePluginsRelativeTo: dirname(require.resolve("eslint-config-next/package.json"))
});
const config = [
  { ignores: [".next/**", "test-results/**", "playwright-report/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];
export default config;
