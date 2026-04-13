<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Throwable;

class FinanceSummaryController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        $analyzerUrl = (string) config('services.analyzer.url');
        $plannerUrl = (string) config('services.planner.url');
        $analyzerApiKey = (string) config('services.analyzer.api_key');
        $plannerApiKey = (string) config('services.planner.api_key');

        if ($analyzerUrl === '' || $plannerUrl === '') {
            return response()->json([
                'message' => 'Analyzer or Planner URL is not configured.',
            ], 500);
        }

        if ($analyzerApiKey === '' || $plannerApiKey === '') {
            return response()->json([
                'message' => 'Analyzer or Planner API key is not configured.',
            ], 500);
        }

        $user = $request->user();

        $transactions = $user->transactions()
            ->orderByDesc('transaction_date')
            ->get([
                'id',
                'user_id',
                'amount',
                'description',
                'category',
                'type',
                'transaction_date',
                'created_at',
                'updated_at',
            ]);

        try {
            $analyzerResponse = Http::acceptJson()
                ->timeout(15)
                ->withHeaders([
                    'x-api-key' => $analyzerApiKey,
                ])
                ->post($analyzerUrl, [
                    'user_id' => $user->id,
                    'transactions' => $transactions,
                ]);
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Analyzer service is unreachable.',
                'error' => $exception->getMessage(),
            ], 502);
        }

        if (! $analyzerResponse->successful()) {
            return response()->json([
                'message' => 'Analyzer service call failed.',
                'status' => $analyzerResponse->status(),
                'error' => $analyzerResponse->body(),
            ], 502);
        }

        $analysis = $analyzerResponse->json();

        try {
            $plannerResponse = Http::acceptJson()
                ->timeout(15)
                ->withHeaders([
                    'x-api-key' => $plannerApiKey,
                ])
                ->post($plannerUrl, [
                    'user_id' => $user->id,
                    'transactions' => $transactions,
                    'analysis' => $analysis,
                ]);
        } catch (Throwable $exception) {
            return response()->json([
                'message' => 'Planner service is unreachable.',
                'error' => $exception->getMessage(),
            ], 502);
        }

        if (! $plannerResponse->successful()) {
            return response()->json([
                'message' => 'Planner service call failed.',
                'status' => $plannerResponse->status(),
                'error' => $plannerResponse->body(),
            ], 502);
        }

        return response()->json([
            'message' => 'Finance summary generated successfully.',
            'data' => [
                'transactions' => $transactions,
                'analysis' => $analysis,
                'plan' => $plannerResponse->json(),
            ],
        ]);
    }
}
