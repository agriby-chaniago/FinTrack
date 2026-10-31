import { ownerRoute } from "@/server/api/owner-route";
import { exportFileName, exportFiles, readExportSnapshot, zipStream } from "@/server/application/export";
import { readExportAnalysis } from "@/server/application/export-analysis";

/** `Pengaturan → Data → Ekspor data`: full ZIP from one consistent snapshot, never cached. */
export const GET = ownerRoute(
  async ({ tx, principal }) => {
    const exportedAt = new Date();
    const datasets = await readExportSnapshot(tx, principal.ownerId);
    const analysis = await readExportAnalysis(tx, principal.ownerId, datasets, exportedAt);
    return new Response(zipStream(exportFiles(datasets, exportedAt, analysis)), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${exportFileName(exportedAt)}"`,
      },
    });
  },
  { transaction: { isolationLevel: "repeatable read", accessMode: "read only" } },
);
