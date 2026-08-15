export default {
  "*.{ts,tsx}": ["oxlint", "oxfmt", () => "pnpm typecheck"],
  "*.{js,jsx,json,html,md}": ["oxfmt"],
  /* Stylelint before oxfmt: the token and primitive rules are the ones worth
     failing a commit over, and there is no point formatting a stylesheet that
     is about to be sent back. */
  "*.css": ["stylelint", "oxfmt"],
};
