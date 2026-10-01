// Telegram digest text (PRD v0.20 P6): task titles and a link only. It is built
// from titles, never from task amounts, so no amount can reach the message.
import { taskTitle } from "@/lib/dashboard-view";

type DigestTask = Parameters<typeof taskTitle>[0];

export function digestText(tasks: DigestTask[], accountName: (id: string) => string, origin: string): string {
  const lines = tasks.map((task) => `• ${taskTitle(task, accountName)}`);
  return [`FinTrack · Perlu dilakukan (${tasks.length})`, "", ...lines, "", `Buka FinTrack: ${origin}`].join("\n");
}
