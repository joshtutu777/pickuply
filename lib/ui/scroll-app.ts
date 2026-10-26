export type ScrollIntent = "restore" | "hash" | "top";

/** Forward navigation starts at the top. Back keeps the browser position. A hash scrolls to that section. */
export function scrollIntent(input: { hash: string; popped: boolean }): ScrollIntent {
  if (input.popped) return "restore";
  if (input.hash) return "hash";
  return "top";
}
