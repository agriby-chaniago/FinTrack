// Theme preference: `system` (default), `light`, or `dark`, stored in a cookie
// so the server renders the right theme before first paint (PRD: Theme).
export const THEME_COOKIE = "fintrack-theme";

export type ThemePreference = "system" | "light" | "dark";

export function parseTheme(value: string | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** `data-theme` for <html>; undefined lets the OS preference choose. */
export function themeAttribute(value: string | undefined): string | undefined {
  const preference = parseTheme(value);
  return preference === "system" ? undefined : `fintrack-${preference}`;
}

/** Client-side: persist and apply a preference without reloading. */
export function applyTheme(preference: ThemePreference): void {
  document.cookie = `${THEME_COOKIE}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`;
  const attribute = themeAttribute(preference);
  if (attribute) document.documentElement.dataset.theme = attribute;
  else delete document.documentElement.dataset.theme;
}
