<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Service2PullRequest;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

class Service2PullController extends Controller
{
    public function transactionsFeed(Service2PullRequest $request, User $user): JsonResponse
    {
        $since = $request->since();
        $maxItems = max((int) config('services.service2_pull.max_items', 1000), 1);

        $query = $user->transactions()
            ->select([
                'id',
                'user_id',
                'amount',
                'description',
                'category',
                'type',
                'transaction_date',
                'created_at',
                'updated_at',
                // Fallback legacy fields for older rows.
                'nominal',
                'deskripsi',
                'kategori',
                'tanggal',
            ])
            ->orderBy('updated_at')
            ->orderBy('id');

        if ($since !== null) {
            $query->where('updated_at', '>', $since->toDateTimeString());
        }

        $result = $query->limit($maxItems + 1)->get();
        $hasMore = $result->count() > $maxItems;

        if ($hasMore) {
            $result = $result->take($maxItems)->values();
        }

        $transactions = $result
            ->map(fn (Transaction $transaction): array => $this->transformTransaction($transaction))
            ->values();

        $latestUpdatedAt = $transactions->max('updated_at');
        $nextSince = is_string($latestUpdatedAt) && $latestUpdatedAt !== ''
            ? $latestUpdatedAt
            : $since?->toIso8601String();

        $data = [
            'transactions' => $transactions,
        ];

        if ($request->includeSummary()) {
            $data['summary'] = $this->buildSummary($transactions);
        }

        return response()->json([
            'success' => true,
            'message' => 'Transactions feed fetched successfully.',
            'data' => $data,
            'meta' => [
                'user_id' => $user->id,
                'requested_at' => now()->toIso8601String(),
                'sync_mode' => $since === null ? 'snapshot' : 'delta',
                'since' => $since?->toIso8601String(),
                'next_since' => $nextSince,
                'total_items' => $transactions->count(),
                'max_items' => $maxItems,
                'has_more' => $hasMore,
            ],
        ]);
    }

    private function transformTransaction(Transaction $transaction): array
    {
        $type = $transaction->type
            ?? ($transaction->kategori === 'pemasukan' ? 'income' : 'expense');

        return [
            'id' => $transaction->id,
            'user_id' => $transaction->user_id,
            'amount' => (int) ($transaction->amount ?? $transaction->nominal ?? 0),
            'description' => (string) ($transaction->description ?? $transaction->deskripsi ?? ''),
            'category' => (string) ($transaction->category ?? 'lainnya'),
            'type' => $type,
            'transaction_date' => $transaction->transaction_date?->toDateString()
                ?? $transaction->tanggal?->toDateString(),
            'created_at' => $transaction->created_at?->toIso8601String(),
            'updated_at' => $transaction->updated_at?->toIso8601String(),
        ];
    }

    private function buildSummary(Collection $transactions): array
    {
        $totalIncome = (int) $transactions->where('type', 'income')->sum('amount');
        $totalExpense = (int) $transactions->where('type', 'expense')->sum('amount');

        $breakdownCategory = $transactions
            ->groupBy(fn (array $item): string => $item['category'] !== '' ? $item['category'] : 'lainnya')
            ->map(fn (Collection $items): array => [
                'count' => $items->count(),
                'total_amount' => (int) $items->sum('amount'),
            ])
            ->sortKeys()
            ->toArray();

        return [
            'total_income' => $totalIncome,
            'total_expense' => $totalExpense,
            'net_balance' => $totalIncome - $totalExpense,
            'breakdown_category' => $breakdownCategory,
        ];
    }
}
