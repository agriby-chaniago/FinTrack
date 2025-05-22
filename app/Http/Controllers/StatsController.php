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
        $startDate = Carbon::now()->subDays(6)->startOfDay();
        $endDate = Carbon::now()->endOfDay();

        $transactions = Transaction::where('user_id', $userId)
            ->whereBetween('tanggal', [$startDate, $endDate])
            ->get();

        $days = [];
        $income = [];
        $expense = [];
        $saldo = [];
        $currentSaldo = 0;

        for ($i = 6; $i >= 0; $i--) {
            $date = Carbon::now()->subDays($i)->startOfDay();
            $dayLabel = $date->translatedFormat('d M');
            $days[] = $dayLabel;

            $dayTransactions = $transactions->filter(function ($transaction) use ($date) {
                return Carbon::parse($transaction->tanggal)->isSameDay($date);
            });

            $totalIncome = $dayTransactions->where('kategori', 'pemasukan')->sum('nominal');
            $totalExpense = $dayTransactions->where('kategori', 'pengeluaran')->sum('nominal');

            $income[] = $totalIncome;
            $expense[] = $totalExpense;

            $currentSaldo += $totalIncome - $totalExpense;
            $saldo[] = $currentSaldo;
        }

        // Komposisi kategori berdasarkan jenis
        $kategoriData = $transactions->groupBy('kategori')->map(function ($group) {
            return $group->sum('nominal');
        });

        return view('stats.index', [
            'days' => $days,
            'income' => $income,
            'expense' => $expense,
            'saldo' => $saldo,
            'kategoriLabels' => $kategoriData->keys(),
            'kategoriValues' => $kategoriData->values()
        ]);
    }
}
