<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Transaction;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;

class StatsController extends Controller
{
    public function index()
    {
        $userId = Auth::id();

        // Ambil 7 hari terakhir
        $startDate = Carbon::now()->subDays(6)->startOfDay();
        $endDate = Carbon::now()->endOfDay();

        // Ambil semua transaksi user dalam rentang tanggal
        $transactions = Transaction::where('user_id', $userId)
            ->whereBetween('tanggal', [$startDate, $endDate])
            ->get();

        // Inisialisasi array untuk data per hari
        $days = [];
        $income = [];
        $expense = [];

        for ($i = 6; $i >= 0; $i--) {
            $date = Carbon::now()->subDays($i)->startOfDay();
            $dayLabel = $date->translatedFormat('d M'); // Contoh: "18 Mei"
            $days[] = $dayLabel;

            $dayTransactions = $transactions->filter(function ($transaction) use ($date) {
                return Carbon::parse($transaction->tanggal)->isSameDay($date);
            });

            $totalIncome = $dayTransactions->where('kategori', 'pemasukan')->sum('nominal');
            $totalExpense = $dayTransactions->where('kategori', 'pengeluaran')->sum('nominal');

            $income[] = $totalIncome;
            $expense[] = $totalExpense;
        }

        return view('stats.index', [
            'months' => $days, // atau ganti ke 'days' di Blade
            'income' => $income,
            'expense' => $expense
        ]);
    }
}
