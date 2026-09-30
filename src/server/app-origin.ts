/**
 * Exact origin used for auth email redirects and callback redirects.
 * APP_ORIGIN wins; on Vercel Preview the stable branch URL is used instead so
 * each preview keeps working without per-branch configuration.
 */
export function appOrigin(): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  const vercelHost = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;
  throw new Error("APP_ORIGIN is not configured");
}
