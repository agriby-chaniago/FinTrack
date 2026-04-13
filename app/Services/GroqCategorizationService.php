<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

class GroqCategorizationService
{
    /**
     * Kategori sub-pengeluaran yang diizinkan.
     * Seluruh output AI akan dipaksa masuk ke daftar ini.
     */
    private const ALLOWED_EXPENSE_CATEGORIES = [
        'makan',
        'transport',
        'belanja',
        'tagihan',
        'hiburan',
        'kesehatan',
        'pendidikan',
        'rumah',
        'cicilan',
        'donasi',
        'investasi',
        'lainnya',
    ];

    /**
     * Kategori sub-pemasukan yang diizinkan.
     */
    private const ALLOWED_INCOME_CATEGORIES = [
        'gaji',
        'bonus',
        'freelance',
        'bisnis',
        'investasi',
        'hadiah',
        'refund',
        'uang saku',
        'lainnya',
    ];

    /**
     * Sinonim output AI yang dipetakan ke kategori internal.
     */
    private const CATEGORY_ALIASES = [
        'makan' => ['food', 'meal', 'snack', 'kuliner', 'jajanan'],
        'transport' => ['transportation', 'commute', 'mobilitas'],
        'belanja' => ['shopping', 'purchase', 'kebutuhan', 'lifestyle', 'rokok', 'vape', 'liquid', 'pod'],
        'tagihan' => ['bill', 'bills', 'utility', 'utilities'],
        'hiburan' => ['entertainment', 'leisure'],
        'kesehatan' => ['health', 'healthcare', 'medical'],
        'pendidikan' => ['education', 'schooling'],
        'rumah' => ['housing', 'home', 'household'],
        'cicilan' => ['installment', 'installments', 'debt payment'],
        'donasi' => ['donation', 'charity'],
        'investasi' => ['investment', 'investments'],
        'gaji' => ['salary', 'payroll'],
        'bonus' => ['incentive', 'incentives'],
        'freelance' => ['project fee', 'gig'],
        'bisnis' => ['business', 'sales'],
        'hadiah' => ['gift', 'reward'],
        'refund' => ['reimbursement'],
        'uang saku' => ['allowance', 'pocket money'],
    ];

    /**
     * Kategori pengeluaran yang keyword deskripsinya dianggap sangat kuat.
     */
    private const KEYWORD_PRIORITY_EXPENSE_CATEGORIES = [
        'makan',
        'transport',
        'belanja',
        'tagihan',
    ];

    /**
     * Kategori pemasukan dengan keyword deskripsi yang dianggap kuat.
     */
    private const KEYWORD_PRIORITY_INCOME_CATEGORIES = [
        'gaji',
        'bonus',
        'freelance',
        'bisnis',
        'investasi',
        'hadiah',
        'refund',
        'uang saku',
    ];

    public function categorize(string $description, string $type = 'expense'): string
    {
        $type = $this->normalizeType($type);
        $allowedCategories = $this->allowedCategoriesForType($type);

        $apiKey = (string) config('services.groq.api_key');

        if ($apiKey === '') {
            throw new RuntimeException('Groq API key is not configured.');
        }

        $response = Http::baseUrl((string) config('services.groq.base_url'))
            ->withToken($apiKey)
            ->acceptJson()
            ->timeout(30)
            ->post('/chat/completions', [
                'model' => (string) config('services.groq.model'),
                'messages' => [
                    [
                        'role' => 'system',
                        'content' => $this->buildSystemPrompt($type, $allowedCategories),
                    ],
                    [
                        'role' => 'user',
                        'content' => $this->buildUserPrompt($type, $description),
                    ],
                ],
                'temperature' => 0,
                'max_tokens' => 10,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException(sprintf('Groq API request failed with status %d.', $response->status()));
        }

        $content = (string) data_get($response->json(), 'choices.0.message.content', '');

        if ($content === '') {
            throw new RuntimeException('Groq API returned an empty response.');
        }

        $category = $this->extractAllowedCategory($content, $allowedCategories);
        $fallback = $this->fallbackCategoryFromDescription($description, $type);

        if ($category !== null) {
            if ($this->shouldPreferFallbackCategory($type, $fallback, $category)) {
                return $fallback;
            }

            return $category;
        }

        return $fallback;
    }

    private function extractAllowedCategory(string $aiText, array $allowedCategories): ?string
    {
        $normalized = $this->normalizeText($aiText);

        foreach ($allowedCategories as $category) {
            if (preg_match('/(^|\s)'.preg_quote($category, '/').'(\s|$)/', $normalized) === 1) {
                return $category;
            }
        }

        foreach (self::CATEGORY_ALIASES as $category => $aliases) {
            if (! in_array($category, $allowedCategories, true)) {
                continue;
            }

            foreach ($aliases as $alias) {
                if (preg_match('/(^|\s)'.preg_quote($alias, '/').'(\s|$)/', $normalized) === 1) {
                    return $category;
                }
            }
        }

        return null;
    }

    private function fallbackCategoryFromDescription(string $description, string $type): string
    {
        $text = $this->normalizeText($description);

        if ($type === 'income') {
            $keywordMap = [
                'gaji' => ['gaji', 'salary', 'payroll', 'upah'],
                'bonus' => ['bonus', 'insentif', 'thr'],
                'freelance' => ['freelance', 'freelancer', 'proyek', 'project'],
                'bisnis' => ['jualan', 'penjualan', 'omzet', 'bisnis', 'usaha'],
                'investasi' => ['dividen', 'kupon', 'capital gain', 'profit investasi', 'investasi'],
                'hadiah' => ['hadiah', 'gift', 'reward'],
                'refund' => ['refund', 'pengembalian', 'retur'],
                'uang saku' => ['uang saku', 'dari ortu', 'dari orang tua', 'dikasih ortu', 'dikasih orang tua', 'jajan'],
            ];

            foreach ($keywordMap as $category => $keywords) {
                foreach ($keywords as $keyword) {
                    if (str_contains($text, $keyword)) {
                        return $category;
                    }
                }
            }

            return 'lainnya';
        }

        $keywordMap = [
            'makan' => ['makan', 'ketoprak', 'nasi', 'ayam', 'kopi', 'resto', 'restoran', 'warung', 'sarapan', 'makan siang', 'makan malam'],
            'transport' => ['transport', 'bensin', 'pertalite', 'tol', 'parkir', 'ojek', 'gojek', 'grab', 'taksi', 'kereta', 'bus'],
            'tagihan' => ['listrik', 'air', 'internet', 'wifi', 'pulsa', 'token', 'pln', 'bpjs', 'tagihan', 'abonemen'],
            'belanja' => ['belanja', 'sembako', 'minimarket', 'supermarket', 'alfamart', 'indomaret', 'marketplace', 'shopee', 'tokopedia', 'rokok', 'vape', 'liquid', 'pod', 'cartridge', 'atomizer', 'mod'],
            'kesehatan' => ['obat', 'dokter', 'rumah sakit', 'klinik', 'apotek', 'vitamin', 'medical'],
            'pendidikan' => ['sekolah', 'kursus', 'kuliah', 'buku', 'les', 'pendidikan', 'ujian'],
            'hiburan' => ['hiburan', 'nonton', 'bioskop', 'game', 'rekreasi', 'liburan', 'travel'],
            'rumah' => ['kontrakan', 'kos', 'sewa', 'perabot', 'renovasi', 'rumah', 'kebersihan'],
            'cicilan' => ['cicilan', 'kredit', 'angsuran', 'pinjaman'],
            'donasi' => ['donasi', 'zakat', 'sedekah', 'amal'],
            'investasi' => ['investasi', 'reksa', 'saham', 'crypto', 'emas'],
        ];

        foreach ($keywordMap as $category => $keywords) {
            foreach ($keywords as $keyword) {
                if (str_contains($text, $keyword)) {
                    return $category;
                }
            }
        }

        return 'lainnya';
    }

    private function allowedCategoriesForType(string $type): array
    {
        return $type === 'income'
            ? self::ALLOWED_INCOME_CATEGORIES
            : self::ALLOWED_EXPENSE_CATEGORIES;
    }

    private function normalizeType(string $type): string
    {
        return $type === 'income' ? 'income' : 'expense';
    }

    private function shouldPreferFallbackCategory(string $type, string $fallbackCategory, string $aiCategory): bool
    {
        if ($fallbackCategory === 'lainnya' || $fallbackCategory === $aiCategory) {
            return false;
        }

        if ($aiCategory === 'lainnya') {
            return true;
        }

        if ($type === 'expense') {
            return in_array($fallbackCategory, self::KEYWORD_PRIORITY_EXPENSE_CATEGORIES, true);
        }

        if ($type === 'income') {
            return in_array($fallbackCategory, self::KEYWORD_PRIORITY_INCOME_CATEGORIES, true);
        }

        return false;
    }

    private function buildSystemPrompt(string $type, array $allowedCategories): string
    {
        $typeText = $type === 'income' ? 'PEMASUKAN' : 'PENGELUARAN';
        $allowed = implode(', ', $allowedCategories);

        return sprintf(
            'Kamu adalah pengklasifikasi sub-kategori %s. Balas tepat satu label huruf kecil dari daftar berikut: %s. Jangan pernah jawab kategori umum seperti pemasukan, pengeluaran, income, expense, transaksi, kategori.',
            $typeText,
            $allowed
        );
    }

    private function buildUserPrompt(string $type, string $description): string
    {
        $typeText = $type === 'income' ? 'pemasukan' : 'pengeluaran';

        return sprintf(
            'Kategorikan deskripsi %s berikut ke satu label dari daftar: %s',
            $typeText,
            $description
        );
    }

    private function normalizeText(string $text): string
    {
        return Str::of($text)
            ->lower()
            ->replaceMatches('/[^a-z0-9\s-]/', ' ')
            ->squish()
            ->value();
    }
}
