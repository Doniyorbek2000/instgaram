import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "data/", "backups/", ".release/", "coverage/", "scratch/", ".claude/"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // HTML ichidagi inline JS satrlarida (\' , \/) ataylab qoldirilgan — natijaga ta'sir qilmaydi
      "no-useless-escape": "off",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
  {
    // Brauzerda ishlaydigan skriptlar (panel sahifalariga ulanadi)
    files: ["src/web/assets/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
    // Eski brauzerlar uchun ES5 uslubida yozilgan (var) — ataylab
    rules: { "no-var": "off" },
  },
];
