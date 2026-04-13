<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Service3PlanResultCallbackRequest;
use App\Models\Service3PlanResult;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class Service3PlanResultController extends Controller
{
    public function callback(Service3PlanResultCallbackRequest $request): JsonResponse
    {
        $payload = $request->payloadForStorage();

        $existing = Service3PlanResult::query()
            ->where('correlation_id', $payload['correlation_id'])
            ->first();

        if ($existing !== null) {
            if ($existing->user_id !== $payload['user_id']) {
                return response()->json([
                    'success' => false,
                    'message' => 'Correlation ID already belongs to another user.',
                ], 409);
            }

            $existing->fill(array_merge($payload, [
                'attempt_count' => $existing->attempt_count + 1,
            ]));
            $existing->save();

            return response()->json([
                'success' => true,
                'message' => 'Service 3 plan result updated successfully.',
                'data' => $this->transform($existing->fresh()),
            ]);
        }

        $record = Service3PlanResult::create(array_merge($payload, [
            'attempt_count' => 1,
        ]));

        return response()->json([
            'success' => true,
            'message' => 'Service 3 plan result stored successfully.',
            'data' => $this->transform($record),
        ], 201);
    }

    public function index(Request $request, User $user): JsonResponse
    {
        if ($user->id !== (int) Auth::id()) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden.',
            ], 403);
        }

        $limit = max(1, min((int) $request->query('limit', 20), 100));

        $results = $user->service3PlanResults()
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get()
            ->map(fn (Service3PlanResult $result): array => $this->transform($result))
            ->values();

        return response()->json([
            'success' => true,
            'message' => 'Service 3 plan results fetched successfully.',
            'data' => $results,
            'meta' => [
                'user_id' => $user->id,
                'total_items' => $results->count(),
                'limit' => $limit,
            ],
        ]);
    }

    public function latest(Request $request, User $user): JsonResponse
    {
        if ($user->id !== (int) Auth::id()) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden.',
            ], 403);
        }

        $result = $user->service3PlanResults()
            ->orderByDesc('created_at')
            ->first();

        if ($result === null) {
            return response()->json([
                'success' => false,
                'message' => 'No Service 3 plan result found for this user.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Latest Service 3 plan result fetched successfully.',
            'data' => $this->transform($result),
        ]);
    }

    private function transform(Service3PlanResult $result): array
    {
        return [
            'id' => $result->id,
            'user_id' => $result->user_id,
            'correlation_id' => $result->correlation_id,
            'analysis_id' => $result->analysis_id,
            'status' => $result->status,
            'summary_text' => $result->summary_text,
            'recommendations' => $result->recommendations,
            'goals' => $result->goals,
            'raw_payload' => $result->raw_payload,
            'plan_period_start' => $result->plan_period_start?->toDateString(),
            'plan_period_end' => $result->plan_period_end?->toDateString(),
            'attempt_count' => $result->attempt_count,
            'last_attempted_at' => $result->last_attempted_at?->toIso8601String(),
            'created_at' => $result->created_at?->toIso8601String(),
            'updated_at' => $result->updated_at?->toIso8601String(),
        ];
    }
}
