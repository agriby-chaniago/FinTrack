<?php

namespace App\Http\Controllers;

use App\Models\AiLog;
use App\Models\Service3PlanResult;
use App\Models\Transaction;
use App\Services\GroqCategorizationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Carbon\Carbon;
use Throwable;

class TransactionController extends Controller
{
    /**
     * Tampilkan halaman daftar transaksi (history).
     */
    public function index()
    {
        $transactions = Transaction::where('user_id', Auth::id())
            ->orderBy('tanggal', 'desc')
            ->get();

        return view('transactions.index', compact('transactions'));
    }

    /**
     * Halaman dashboard dengan total pemasukan, pengeluaran, dan sisa uang.
     */
    public function dashboard()
    {
        $userId = (int) Auth::id();

        $totalIncome = Transaction::where('user_id', $userId)
            ->where('kategori', 'pemasukan')
            ->sum('nominal');

        $totalExpense = Transaction::where('user_id', $userId)
            ->where('kategori', 'pengeluaran')
            ->sum('nominal');

        $remainingBalance = $totalIncome - $totalExpense;

        // Ambil 7 hari terakhir
        $days = collect(range(6, 0))->map(function ($i) {
            return Carbon::today()->subDays($i)->toDateString();
        });

        // Format ke nama hari (Mon, Tue, ...)
        $daysFormatted = $days->map(fn($d) => Carbon::parse($d)->format('D'));

        // Inisialisasi series
        $incomeSeries = [];
        $expenseSeries = [];

        foreach ($days as $day) {
            $income = Transaction::where('user_id', $userId)
                ->where('kategori', 'pemasukan')
                ->whereDate('tanggal', $day)
                ->sum('nominal');

            $expense = Transaction::where('user_id', $userId)
                ->where('kategori', 'pengeluaran')
                ->whereDate('tanggal', $day)
                ->sum('nominal');

            $incomeSeries[] = $income;
            $expenseSeries[] = $expense;
        }

        $transactions = Transaction::where('user_id', $userId)
            ->orderBy('tanggal', 'desc')
            ->limit(10)
            ->get([
                'tanggal',
                'kategori',
                'nominal',
                'deskripsi',
                'transaction_date',
                'type',
                'amount',
                'description',
                'category',
            ]);

        $latestService3Plan = Service3PlanResult::query()
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->first();

        $recentService3Plans = Service3PlanResult::query()
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->limit(5)
            ->get([
                'id',
                'status',
                'summary_text',
                'correlation_id',
                'analysis_id',
                'plan_period_start',
                'plan_period_end',
                'created_at',
            ]);

        $service3TotalPlans = Service3PlanResult::query()
            ->where('user_id', $userId)
            ->count();

        $service3SuccessPlans = Service3PlanResult::query()
            ->where('user_id', $userId)
            ->where('status', 'success')
            ->count();

        $service3FailedPlans = Service3PlanResult::query()
            ->where('user_id', $userId)
            ->where('status', 'failed')
            ->count();

        $service3SuccessRate = $service3TotalPlans > 0
            ? round(($service3SuccessPlans / $service3TotalPlans) * 100, 1)
            : 0.0;

        $service3Stats = [
            'total' => $service3TotalPlans,
            'success' => $service3SuccessPlans,
            'failed' => $service3FailedPlans,
            'success_rate' => $service3SuccessRate,
            'last_synced_at' => $latestService3Plan?->created_at,
        ];

        return view('dashboard', compact(
            'totalIncome',
            'totalExpense',
            'remainingBalance',
            'incomeSeries',
            'expenseSeries',
            'daysFormatted',
            'transactions',
            'latestService3Plan',
            'recentService3Plans',
            'service3Stats'
        ));
    }

    /**
     * Form tambah transaksi baru.
     */
    public function create()
    {
        return view('transactions.create');
    }

    /**
     * Simpan transaksi baru.
     */
    public function store(Request $request, GroqCategorizationService $categorizationService)
    {
        $validated = $request->validate([
            'tanggal'   => 'required|date',
            'kategori'  => 'required|in:pemasukan,pengeluaran',
            'deskripsi' => 'required|string|max:255',
            'nominal'   => 'required|integer|min:1',
        ]);

        $validated['user_id'] = (int) Auth::id();

        $type = $this->mapLegacyCategoryToType($validated['kategori']);
        $aiCategory = $this->resolveAiCategory($categorizationService, $validated['deskripsi'], $type);

        if ($aiCategory !== '') {
            AiLog::create([
                'user_id' => $validated['user_id'],
                'input_text' => $validated['deskripsi'],
                'ai_response' => $aiCategory,
            ]);
        }

        $validated['transaction_date'] = $validated['tanggal'];
        $validated['type'] = $type;
        $validated['amount'] = $validated['nominal'];
        $validated['description'] = $validated['deskripsi'];
        $validated['category'] = $aiCategory;

        Transaction::create($validated);

        return redirect()->route('transactions.index')->with('success', 'Transaksi berhasil ditambahkan.');
    }

    /**
     * Tampilkan detail transaksi (opsional).
     */
    public function show(Transaction $transaction)
    {
        if ($transaction->user_id !== (int) Auth::id()) {
            abort(403);
        }

        return view('transactions.show', compact('transaction'));
    }

    /**
     * Tampilkan form edit transaksi (opsional, tidak dipakai jika pakai modal).
     */
    public function edit(Transaction $transaction)
    {
        if ($transaction->user_id !== (int) Auth::id()) {
            abort(403);
        }

        return view('transactions.edit', compact('transaction'));
    }

    /**
     * Update transaksi dari modal.
     */
    public function update(Request $request, $id, GroqCategorizationService $categorizationService)
    {
        $transaction = Transaction::findOrFail($id);

        if ($transaction->user_id !== (int) Auth::id()) {
            abort(403);
        }

        $validated = $request->validate([
            'tanggal'   => 'required|date',
            'kategori'  => 'required|in:pemasukan,pengeluaran',
            'deskripsi' => 'required|string|max:255',
            'nominal'   => 'required|integer|min:1',
            'category'  => 'nullable|string|max:100',
        ]);

        $type = $this->mapLegacyCategoryToType($validated['kategori']);
        $aiCategory = $transaction->category ?? '';
        $descriptionChanged = $transaction->deskripsi !== $validated['deskripsi'];
        $currentType = $transaction->type ?: $this->mapLegacyCategoryToType((string) $transaction->kategori);
        $typeChanged = $currentType !== $type;
        $manualCategory = Str::of((string) ($validated['category'] ?? ''))
            ->lower()
            ->replaceMatches('/[^a-z0-9\s-]/', ' ')
            ->squish()
            ->value();

        unset($validated['category']);

        if ($manualCategory !== '') {
            $aiCategory = $manualCategory;
        }

        if ($manualCategory === '' && ($aiCategory === '' || $descriptionChanged || $typeChanged)) {
            $aiCategory = $this->resolveAiCategory($categorizationService, $validated['deskripsi'], $type);

            if ($aiCategory !== '') {
                AiLog::create([
                    'user_id' => $transaction->user_id,
                    'input_text' => $validated['deskripsi'],
                    'ai_response' => $aiCategory,
                ]);
            }
        }

        if ($manualCategory !== '' && $manualCategory !== ($transaction->category ?? '')) {
            AiLog::create([
                'user_id' => $transaction->user_id,
                'input_text' => $validated['deskripsi'],
                'ai_response' => $manualCategory,
            ]);
        }

        $validated['transaction_date'] = $validated['tanggal'];
        $validated['type'] = $type;
        $validated['amount'] = $validated['nominal'];
        $validated['description'] = $validated['deskripsi'];
        $validated['category'] = $aiCategory;

        $transaction->update($validated);

        return redirect()->route('transactions.index')->with('success', 'Transaksi berhasil diperbarui.');
    }

    /**
     * Hapus transaksi dari tombol di table.
     */
    public function destroy($id)
    {
        $transaction = Transaction::findOrFail($id);

        if ($transaction->user_id !== (int) Auth::id()) {
            abort(403);
        }

        $transaction->delete();

        return redirect()->route('transactions.index')->with('success', 'Transaksi berhasil dihapus.');
    }

    private function mapLegacyCategoryToType(string $legacyCategory): string
    {
        return $legacyCategory === 'pemasukan' ? 'income' : 'expense';
    }

    private function resolveAiCategory(GroqCategorizationService $categorizationService, string $description, string $type): string
    {
        try {
            return $categorizationService->categorize($description, $type);
        } catch (Throwable) {
            return 'lainnya';
        }
    }
}
