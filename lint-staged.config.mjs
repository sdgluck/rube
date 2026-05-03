export default {
  "*.{ts,tsx}": ["oxlint", "oxfmt", () => "pnpm typecheck"],
  "*.{js,jsx,json,css,html,md}": ["oxfmt"],
};
