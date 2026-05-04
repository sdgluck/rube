export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export function extractClaudeText(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === "text");
  if (!block || typeof block.text !== "string") {
    throw new Error("Claude response contained no text block");
  }
  return block.text.trim();
}
