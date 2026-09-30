import { handleKeepalive, queryKeepaliveProbe } from "@/server/ops/keepalive";

// Operational maintenance only: called by the GitHub Actions keepalive workflow.
// It never accepts owner credentials and never touches financial tables.
export async function POST(request: Request): Promise<Response> {
  return handleKeepalive(request, {
    environment: process.env.VERCEL_ENV,
    expectedToken: process.env.KEEPALIVE_TOKEN,
    probe: () => queryKeepaliveProbe(process.env.KEEPALIVE_DATABASE_URL),
  });
}
