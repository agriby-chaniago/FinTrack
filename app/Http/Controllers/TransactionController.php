<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class TransactionController extends Controller
{
    /**
     * Tampilkan halaman daftar transaksi (history).
     */
    public function index()
    {
        $transactions = Transaction::where('user_id', auth()->id())
            ->orderBy('tanggal', 'desc')
            ->get();

        return view('transactions.index', compact('transactions'));
    }

    /**
     * Halaman dashboard dengan total pemasukan, pengeluaran, dan sisa uang.
     */
    public function dashboard()
    {
        $userId = auth()->id();

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
            ->get(['tanggal', 'kategori', 'nominal', 'deskripsi']);

        return view('dashboard', compact(
            'totalIncome',
            'totalExpense',
            'remainingBalance',
            'incomeSeries',
            'expenseSeries',
            'daysFormatted',
            'transactions'
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
    public function store(Request $request)
    {
        $validated = $request->validate([
            'tanggal'   => 'required|date',
            'kategori'  => 'required|in:pemasukan,pengeluaran',
            'deskripsi' => 'required|string|max:255',
            'nominal'   => 'required|integer|min:1',
        ]);

        $validated['user_id'] = auth()->id();

        Transaction::create($validated);

        return redirect()->route('transactions.index')->with('success', 'Transaksi berhasil ditambahkan.');
    }

    /**
     * Tampilkan detail transaksi (opsional).
     */
    public function show(Transaction $transaction)
    {
        $this->authorize('view', $transaction);
        return view('transactions.show', compact('transaction'));
    }

    /**
     * Tampilkan form edit transaksi (opsional, tidak dipakai jika pakai modal).
     */
    public function edit(Transaction $transaction)
    {
        if ($transaction->user_id !== auth()->id()) {
            abort(403);
        }

        return view('transactions.edit', compact('transaction'));
    }

    /**
     * Update transaksi dari modal.
     */
    public function update(Request $request, $id)
    {
        $transaction = Transaction::findOrFail($id);

        if ($transaction->user_id !== auth()->id()) {
            abort(403);
        }

        $validated = $request->validate([
            'tanggal'   => 'required|date',
            'kategori'  => 'required|in:pemasukan,pengeluaran',
            'deskripsi' => 'required|string|max:255',
            'nominal'   => 'required|integer|min:1',
        ]);

        $transaction->update($validated);

        return redirect()->route('transactions.index')->with('success', 'Transaksi berhasil diperbarui.');
    }

    /**
     * Hapus transaksi dari tombol di table.
     */
    public function destroy($id)
    {
        $transaction = Transaction::findOrFail($id);

        if ($transaction->user_id !== auth()->id()) {
            abort(403);
        }

        $transaction->delete();

        return redirect()->route('transactions.index')->with('success', 'Transaksi berhasil dihapus.');
    }
}
