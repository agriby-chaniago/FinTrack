import { deliverDailyDigest } from "@/server/application/reminders";
import { getRuntimeDb } from "@/server/db/client";
import { handleReminder } from "@/server/ops/reminder";
import { telegramSender } from "@/server/ops/telegram";

// Operational trigger for the daily Telegram digest (PRD v0.20 P6), called by the
// GitHub Actions schedule. It never accepts owner credentials.
export async function POST(request: Request): Promise<Response> {
  return handleReminder(request, {
    environment: process.env.VERCEL_ENV,
    expectedToken: process.env.REMINDER_TOKEN,
    deliver: () => deliverDailyDigest(getRuntimeDb(), new Date(), process.env.APP_ORIGIN ?? "", telegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID)),
  });
}
