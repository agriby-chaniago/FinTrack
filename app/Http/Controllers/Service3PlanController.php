<?php

namespace App\Http\Controllers;

use App\Models\Service3PlanResult;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class Service3PlanController extends Controller
{
    public function index(Request $request): View
    {
        $userId = (int) Auth::id();
        $search = trim((string) $request->query('search', ''));

        $successfulPlansQuery = Service3PlanResult::query()
            ->where('user_id', $userId)
            ->where('status', 'success');

        $totalPlans = (clone $successfulPlansQuery)->count();

        $plansQuery = (clone $successfulPlansQuery)
            ->orderByDesc('created_at');

        if ($search !== '') {
            $plansQuery->where('summary_text', 'like', "%{$search}%");
        }

        $latestPlan = (clone $plansQuery)
            ->orderByDesc('created_at')
            ->first();

        $plans = $plansQuery
            ->paginate(10)
            ->withQueryString();

        $latestRecommendationsCount = is_array($latestPlan?->recommendations)
            ? count($latestPlan->recommendations)
            : 0;

        $latestGoalsCount = is_array($latestPlan?->goals)
            ? count($latestPlan->goals)
            : 0;

        return view('service3.index', [
            'latestPlan' => $latestPlan,
            'plans' => $plans,
            'stats' => [
                'total_plans' => $totalPlans,
                'latest_recommendations' => $latestRecommendationsCount,
                'latest_goals' => $latestGoalsCount,
                'last_updated_at' => $latestPlan?->created_at,
            ],
            'filters' => [
                'search' => $search,
            ],
        ]);
    }
}
