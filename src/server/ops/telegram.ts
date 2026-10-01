// One-way Telegram delivery (PRD v0.20 P6). The bot token is part of the URL, so
// errors carry only a status code and nothing here logs the request.
export function telegramSender(token: string | undefined, chatId: string | undefined, fetchImpl: typeof fetch = fetch) {
  return async (text: string): Promise<void> => {
    if (!token || !chatId) throw new Error("TELEGRAM_NOT_CONFIGURED");
    let response: Response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("TELEGRAM_UNREACHABLE");
    }
    if (!response.ok) throw new Error(`TELEGRAM_${response.status}`);
  };
}
