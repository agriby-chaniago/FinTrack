import { describe, expect, it } from "vitest";

import { digestText } from "./reminder-text";

const name = () => "BCA";
const tasks = [
  { type: "SETTLEMENT" as const, mode: "OVERDUE", periodStart: "2026-09-21", normalEnd: "2026-09-27", draftId: null },
  { type: "CONFIRM_INCOME" as const, cycleKey: "2026-10", occurrenceId: "o1", name: "Income bulanan", label: null, expectedAmount: "750000", expectedDate: null },
  { type: "TRANSFER" as const, targetId: "t1", route: "BCA → Jago", amount: "400000", linked: "0", remaining: "400000", transferNow: "350000", contextKey: "2026-09" },
];

describe("digestText", () => {
  it("lists every task title and the link", () => {
    const text = digestText(tasks, name, "https://fintrack.example");
    expect(text).toContain("Perlu dilakukan (3)");
    expect(text).toContain("• Settlement terlambat");
    expect(text).toContain("• Konfirmasi income bulanan");
    expect(text).toContain("• Transfer BCA → Jago");
    expect(text.trim().endsWith("https://fintrack.example")).toBe(true);
  });

  it("lists at most 10 titles and says how many more remain", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ type: "CONFIRM_OBLIGATION" as const, cycleKey: "2026-10", occurrenceId: `o${i}`, name: `Langganan ${i + 1}`, label: null, expectedAmount: null, expectedDate: null }));
    const text = digestText(many, name, "https://fintrack.example");
    expect(text).toContain("Perlu dilakukan (25)");
    expect(text.split("\n").filter((line) => line.startsWith("• Konfirmasi"))).toHaveLength(10);
    expect(text).toContain("• dan 15 tugas lain");
    expect(text.length).toBeLessThan(4096);
  });

  it("never prints an amount", () => {
    const text = digestText(tasks, name, "https://fintrack.example");
    expect(text).not.toMatch(/Rp|750|400|350/);
  });
});
