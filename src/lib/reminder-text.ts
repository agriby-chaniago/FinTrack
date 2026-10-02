// Telegram digest text (PRD v0.20 P6): task titles and a link only. It is built
// from titles, never from task amounts, so no amount can reach the message.
import { taskTitle } from "@/lib/dashboard-view";

type DigestTask = Parameters<typeof taskTitle>[0];

/** At most this many titles, so the message stays far below Telegram's 4096 characters. */
const MAX_TITLES = 10;

export function digestText(tasks: DigestTask[], accountName: (id: string) => string, origin: string): string {
  const lines = tasks.slice(0, MAX_TITLES).map((task) => `• ${taskTitle(task, accountName)}`);
  if (tasks.length > MAX_TITLES) lines.push(`• dan ${tasks.length - MAX_TITLES} tugas lain`);
  return [`FinTrack · Perlu dilakukan (${tasks.length})`, "", ...lines, "", `Buka FinTrack: ${origin}`].join("\n");
}
