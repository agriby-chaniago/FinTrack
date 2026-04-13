<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiLog;
use App\Models\Transaction;
use App\Services\GroqCategorizationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class TransactionController extends Controller
{
    public function __construct(private readonly GroqCategorizationService $categorizationService)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $transactions = $request->user()
            ->transactions()
            ->orderByDesc('transaction_date')
            ->orderByDesc('created_at')
            ->get();

        return response()->json([
            'data' => $transactions,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'amount' => ['required', 'integer', 'min:1'],
            'description' => ['required', 'string', 'max:255'],
            'type' => ['required', 'in:income,expense'],
            'transaction_date' => ['required', 'date'],
        ]);

        try {
            $category = $this->categorizationService->categorize(
                $validated['description'],
                $validated['type']
            );
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'AI categorization failed.',
                'error' => $exception->getMessage(),
            ], 502);
        }

        $transaction = $request->user()->transactions()->create([
            'amount' => $validated['amount'],
            'description' => $validated['description'],
            'category' => $category,
            'type' => $validated['type'],
            'transaction_date' => $validated['transaction_date'],
            'tanggal' => $validated['transaction_date'],
            'kategori' => $this->legacyType($validated['type']),
            'deskripsi' => $validated['description'],
            'nominal' => $validated['amount'],
        ]);

        if ($category !== '') {
            AiLog::create([
                'user_id' => $request->user()->id,
                'input_text' => $validated['description'],
                'ai_response' => $category,
            ]);
        }

        return response()->json([
            'message' => 'Transaction created successfully.',
            'data' => $transaction,
        ], 201);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $transaction = $request->user()->transactions()->findOrFail($id);

        return response()->json([
            'data' => $transaction,
        ]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        /** @var Transaction $transaction */
        $transaction = $request->user()->transactions()->findOrFail($id);

        $validated = $request->validate([
            'amount' => ['sometimes', 'integer', 'min:1'],
            'description' => ['sometimes', 'string', 'max:255'],
            'category' => ['sometimes', 'string', 'max:100'],
            'type' => ['sometimes', 'in:income,expense'],
            'transaction_date' => ['sometimes', 'date'],
        ]);

        $currentDate = $transaction->transaction_date?->toDateString()
            ?? $transaction->tanggal?->toDateString()
            ?? now()->toDateString();

        $amount = $validated['amount'] ?? $transaction->amount ?? $transaction->nominal;
        $description = $validated['description'] ?? $transaction->description ?? $transaction->deskripsi;
        $type = $validated['type']
            ?? $transaction->type
            ?? ($transaction->kategori === 'pemasukan' ? 'income' : 'expense');
        $category = $validated['category'] ?? $transaction->category ?? $transaction->kategori;
        $date = $validated['transaction_date'] ?? $currentDate;

        $transaction->update([
            'amount' => $amount,
            'description' => $description,
            'category' => $category,
            'type' => $type,
            'transaction_date' => $date,
            'tanggal' => $date,
            'kategori' => $this->legacyType($type),
            'deskripsi' => $description,
            'nominal' => $amount,
        ]);

        return response()->json([
            'message' => 'Transaction updated successfully.',
            'data' => $transaction->fresh(),
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $transaction = $request->user()->transactions()->findOrFail($id);
        $transaction->delete();

        return response()->json([
            'message' => 'Transaction deleted successfully.',
        ]);
    }

    private function legacyType(string $type): string
    {
        return $type === 'income' ? 'pemasukan' : 'pengeluaran';
    }
}
