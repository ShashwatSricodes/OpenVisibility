import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts", "scripts/fixtures/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    rules: {
      // the landing template ships pre-sized, pre-optimized images with explicit
      // width/height and lazy loading, so plain <img> is intentional there
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
