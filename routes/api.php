<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\FinanceSummaryController;
use App\Http\Controllers\Api\Service2PullController;
use App\Http\Controllers\Api\TransactionController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function (): void {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);

    Route::middleware('auth:sanctum')->post('/logout', [AuthController::class, 'logout']);
});

Route::middleware('auth:sanctum')->group(function (): void {
    Route::apiResource('transactions', TransactionController::class)
        ->names('api.transactions');
});

Route::middleware(['auth:sanctum', 'service.api_key'])
    ->get('/finance/summary', [FinanceSummaryController::class, 'summary']);

Route::middleware('service.api_key:service2_pull')
    ->get('/service2/users/{user}/transactions-feed', [Service2PullController::class, 'transactionsFeed'])
    ->whereNumber('user');
