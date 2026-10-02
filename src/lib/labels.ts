// User-facing Indonesian labels. Domain terms stay in code; the UI speaks plainly.

export const balanceStatusLabel: Record<string, string> = {
  CONFIRMED: "Dikonfirmasi",
  CALCULATED_AFTER_CONFIRMATION: "Terhitung setelah konfirmasi",
  OPEN_WEEK: "Minggu berjalan",
  NEEDS_REVIEW: "Perlu diperiksa",
  DISCREPANCY: "Ada selisih",
};

export const cycleStateLabel: Record<string, string> = {
  WAITING_FOR_PRIOR_CYCLE: "Menunggu siklus sebelumnya",
  WAITING_FOR_INCOME: "Menunggu income",
  WAITING_FOR_OBLIGATIONS: "Menunggu kewajiban",
  CLOSED_NO_INCOME: "Ditutup tanpa income",
  READY_TO_TRANSFER: "Siap transfer",
  PARTIALLY_TRANSFERRED: "Sebagian ditransfer",
  COMPLETE: "Selesai",
};

export const cycleNoteLabel: Record<string, string> = {
  NO_TRANSFER_NEEDED: "Tidak ada transfer yang diperlukan",
  EXCEEDS_SUGGESTION: "Transfer melebihi saran",
  NO_AUTOMATIC_SUGGESTION: "Tidak ada saran transfer otomatis",
  TARGET_CLOSED: "Target ditutup",
};

export const progressLabel: Record<string, string> = {
  PENDING_READINESS: "Menunggu siklus siap",
  NO_TRANSFER_NEEDED: "Tidak ada transfer yang diperlukan",
  NOT_TRANSFERRED: "Belum ditransfer",
  PARTIALLY_TRANSFERRED: "Sebagian ditransfer",
  FULLY_TRANSFERRED: "Sudah ditransfer penuh",
  EXCEEDS_SUGGESTION: "Melebihi saran",
  CLOSED: "Ditutup",
};

export const occurrenceStatusLabel: Record<string, string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Dikonfirmasi",
  NOT_RECEIVED: "Tidak diterima",
  NOT_CHARGED: "Tidak ditagih",
};

/** Icon beside each occurrence status: waiting reads as a clock, never as a check. */
export const occurrenceStatusIcon: Record<string, "clock" | "check" | "minus"> = {
  PENDING: "clock",
  CONFIRMED: "check",
  NOT_RECEIVED: "minus",
  NOT_CHARGED: "minus",
};

export const occurrenceTagLabel: Record<string, string> = {
  OVERDUE: "Terlambat",
  LATE: "Masuk terlambat",
  DUE_SOON: "Segera",
  NEEDS_REVIEW: "Perlu diperiksa",
};

export const eventClassLabel: Record<string, string> = {
  MONTHLY_INCOME: "Income bulanan",
  OTHER_INCOME: "Income lain",
  SPECIAL_EXPENSE: "Pengeluaran khusus",
  RECURRING_EXPENSE: "Kewajiban bulanan",
  OTHER_EXPENSE: "Pengeluaran lain",
  PERSONAL_TRANSFER: "Transfer",
  EXTERNAL_MOVEMENT: "Dana titipan",
  LIVING: "Biaya hidup mingguan",
  ADJUSTMENT: "Penyesuaian saldo",
};

export const movementTypeLabel: Record<string, string> = {
  RECEIPT: "Terima dana titipan",
  RETURN: "Kembalikan dana",
  OWNER_USE: "Bayar kebutuhan pemilik",
  INTERNAL_TRANSFER: "Pindahkan antar-akun",
  CONVERT_TO_PERSONAL: "Menjadi uang pribadi",
  CONVERT_TO_EXTERNAL: "Menjadi dana titipan",
};

export const settlementModeLabel: Record<string, string> = {
  NORMAL: "Settlement minggu ini siap diselesaikan",
  OVERDUE: "Settlement terlambat",
  DRAFT: "Settlement sedang dikerjakan",
  INFORMATIONAL: "Belum waktunya settlement",
};

export const completenessLabel: Record<string, string> = {
  LENGKAP: "Lengkap",
  SEMENTARA: "Sementara",
  PERIODE_PARSIAL: "Periode parsial",
};

/** Messages for API error codes and validation issues shown inline. */
export const errorMessage: Record<string, string> = {
  INVALID_IDENTITY: "Sesi berakhir. Silakan masuk kembali.",
  NOT_OWNER: "Akun ini tidak memiliki akses.",
  STALE_VERSION: "Data sudah berubah. Muat ulang halaman lalu coba lagi.",
  INVARIANT_VIOLATION: "Perubahan ini membuat dana titipan menjadi negatif pada suatu tanggal.",
  IDEMPOTENCY_KEY_REUSED: "Permintaan ini bentrok dengan permintaan sebelumnya. Muat ulang halaman.",
  NOT_FOUND: "Data tidak ditemukan.",
  INTERNAL_ERROR: "Terjadi kesalahan. Data belum tersimpan.",
  NETWORK: "Belum tersimpan. Periksa koneksi lalu coba lagi.",
  BUSINESS_DATE_BEFORE_CUTOVER: "Tanggal sebelum waktu mulai FinTrack tidak dapat dicatat.",
  BUSINESS_DATE_IN_FUTURE: "Tanggal tidak boleh di masa depan.",
  ACCOUNT_NOT_ACTIVE: "Akun tidak aktif.",
  CATEGORY_NOT_ACTIVE: "Kategori sudah diarsipkan.",
  CATEGORY_NAME_RESERVED: "Nama kategori ini tidak dapat dipakai.",
  DUPLICATE_NAME: "Nama ini sudah dipakai.",
  USE_SPECIAL_EXPENSE_FOR_WEEKLY_ACCOUNT: "Pengeluaran dari DANA dicatat sebagai pengeluaran khusus.",
  USE_SETTLEMENT_FOR_WEEKLY_ACCOUNT: "Saldo DANA diperbarui melalui settlement mingguan.",
  SUBJECT_HAS_OUTSTANDING: "Masih ada dana titipan yang belum dikembalikan.",
  EXTERNAL_EXCEEDS_TRANSFER: "Bagian dana titipan melebihi jumlah transfer.",
  SAME_ACCOUNT: "Akun asal dan tujuan harus berbeda.",
  TARGET_NOT_CLOSABLE: "Target ini tidak dapat ditutup.",
  NONSTANDARD_RANGE: "Periode harus berakhir hari Minggu, kecuali catch-up untuk periode yang terlambat.",
  END_IN_FUTURE: "Tanggal akhir tidak boleh di masa depan.",
  CLOSING_NOT_ON_END_DATE: "Waktu saldo penutup harus pada tanggal akhir periode.",
  CLOSING_IN_FUTURE: "Waktu saldo penutup tidak boleh di masa depan.",
  CLOSING_REQUIRED: "Isi saldo penutup terlebih dahulu.",
  DRAFT_EXISTS: "Masih ada draft settlement.",
  BEFORE_OPEN_PERIOD: "Tanggal ini sudah masuk periode yang disettle.",
  UPCOMING_EXISTS: "Sudah ada perubahan terjadwal. Batalkan dulu sebelum menjadwalkan yang baru.",
  NO_OP: "Status income sudah seperti itu pada tanggal tersebut.",
  DUPLICATE_DATE: "Sudah ada perubahan pada tanggal ini.",
  CONFLICTS_WITH_LATER_TRANSITION: "Bertentangan dengan perubahan berikutnya.",
  DATE_NOT_ACTIVE: "Income harian tidak aktif pada tanggal ini.",
  NO_CHANGE: "Tidak ada perubahan.",
  NO_DISCREPANCY: "Tidak ada selisih yang perlu disesuaikan.",
  ALREADY_CORRECTED: "Catatan ini sudah dikoreksi. Koreksi catatan penggantinya.",
  NOT_A_CORRECTABLE_RECORD: "Catatan ini tidak dapat dikoreksi langsung.",
  USE_DEDICATED_CORRECTION_FLOW: "Catatan ini dikoreksi melalui alurnya sendiri.",
  USE_OCCURRENCE_RESOLUTION: "Tandai tidak terjadi melalui halaman Rutinitas.",
  USE_KOREKSI_FOR_VALUES: "Sudah dikonfirmasi. Gunakan Koreksi untuk mengubah nominal atau tanggal.",
  ACTUAL_DATE_AND_AMOUNT_REQUIRED: "Tanggal dan nominal aktual wajib diisi.",
  REVISION_MUST_BE_PROSPECTIVE: "Perubahan jadwal hanya berlaku mulai bulan depan.",
  LAST_CYCLE_IN_PAST: "Bulan terakhir tidak boleh sebelum bulan ini.",
  RETAINED_FLOOR_REQUIRED: "Saldo minimum ditahan belum diisi.",
  AS_OF_IN_FUTURE: "Waktu saldo tidak boleh di masa depan.",
  ACCOUNTS_MUST_MATCH_OPENING: "Isi saldo untuk setiap akun di saldo awal.",
  CATEGORY_MISMATCH: "Kategori tidak cocok dengan jenis catatan ini.",
  DUPLICATE_EXTERNAL_POSITION: "Pemilik dana yang sama muncul dua kali di akun yang sama.",
  DUPLICATE_SUBJECT: "Pemilik dana yang sama dipilih lebih dari sekali.",
  END_BEFORE_START: "Tanggal akhir sebelum awal periode.",
  EXTERNAL_AMOUNT_MUST_BE_POSITIVE: "Nominal dana titipan harus lebih dari Rp0.",
  HOLDING_NOT_FOUND: "Dana titipan tidak ditemukan.",
  INVALID_BUSINESS_DATE: "Tanggal tidak valid.",
  INVALID_MONTH: "Bulan tidak valid.",
  LAST_BEFORE_FIRST: "Bulan terakhir tidak boleh sebelum bulan pertama.",
  NEGATIVE_PHYSICAL_BALANCE: "Saldo fisik tidak boleh negatif.",
  NOT_A_WEEKLY_ACCOUNT: "Akun ini tidak memakai settlement mingguan.",
  OUTCOME_NOT_ALLOWED: "Pilihan ini tidak berlaku untuk kejadian ini.",
  SETTLED_PERIOD: "Tanggal ini sudah masuk periode yang disettle.",
  SETTLEMENT_IMMUTABLE: "Settlement sudah selesai dan tidak dapat diubah.",
  SUBJECT_ARCHIVED: "Pemilik dana ini sudah diarsipkan.",
  SUBJECT_NOT_FOUND: "Pemilik dana tidak ditemukan.",
  SUBJECT_REQUIRED: "Pilih atau isi nama pemilik dana.",
  SUBSCRIPTION_NEEDS_DAY_AND_AMOUNT: "Langganan memerlukan tanggal dan nominal.",
  UNKNOWN_ACCOUNT: "Akun tidak dikenal.",
  CASH_CLOSING_REQUIRED: "Isi uang tunai di dompet saat penutupan.",
  CASH_ALREADY_TRACKED: "Uang tunai sudah dilacak.",
  CASH_NOT_TRACKED: "Uang tunai belum dilacak. Pilih Mulai lacak uang tunai pada settlement.",
  CUTOVER_DAY_CONFIRMATION_REQUIRED: "Jawab dulu apakah kejadian ini sudah termasuk saldo awal.",
  VALIDATION_FAILED: "Isian belum valid. Periksa kembali.",
  PRECONDITION_REQUIRED: "Muat ulang halaman lalu coba lagi.",
  IDEMPOTENCY_KEY_REQUIRED: "Muat ulang halaman lalu coba lagi.",
  ONBOARDING_NOT_CONFIRMED: "Selesaikan onboarding terlebih dahulu.",
};

const fieldLabel: Record<string, string> = {
  amount: "nominal",
  actualAmount: "nominal aktual",
  actualDate: "tanggal aktual",
  businessDate: "tanggal",
  effectiveDate: "tanggal berlaku",
  closingPhysicalBalance: "saldo penutupan",
  closingAt: "waktu saldo penutupan",
  physicalBalance: "saldo",
  asOf: "waktu saldo",
  expectedDay: "tanggal",
  expectedAmount: "nominal",
  lastCycle: "bulan terakhir",
  effectiveFromCycle: "bulan berlaku",
  name: "nama",
  displayName: "nama",
  subjectName: "nama pemilik dana",
  newCategoryName: "nama kategori",
  note: "catatan",
};

/** Validation details → plain sentences; unknown schema paths get a generic field message. */
export function issueMessages(details: unknown): string[] {
  const issues = (details as { issues?: unknown[] } | undefined)?.issues ?? [];
  const messages = issues.map((issue) => {
    if (typeof issue === "string") return errorMessage[issue] ?? issue;
    const { code, message, path } = issue as { code?: string; message?: string; path?: string };
    if (code) return errorMessage[code] ?? code;
    if (message && /^[A-Z_]+$/.test(message)) return errorMessage[message] ?? message;
    const field = path ? fieldLabel[path.split(".").at(-1) ?? ""] : undefined;
    return field ? `Isian ${field} belum valid.` : errorMessage.VALIDATION_FAILED;
  });
  return [...new Set(messages)];
}
