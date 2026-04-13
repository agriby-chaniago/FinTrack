<?php

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use function Pest\Laravel\getJson;

beforeEach(function () {
    Config::set('services.service2_pull.api_key', 'service2-secret');
    Config::set('services.service2_pull.max_items', 1000);
    Config::set('services.inter_service.api_key', 'legacy-secret');
    Config::set('services.inter_service.allow_legacy_fallback', true);
});

it('returns snapshot feed with details and summary', function () {
    $user = User::factory()->create();

    $createTransaction = function (array $overrides) use ($user): Transaction {
        $payload = array_merge([
            'user_id' => $user->id,
            'amount' => 0,
            'description' => 'default',
            'category' => 'lainnya',
            'type' => 'expense',
            'transaction_date' => '2026-04-13',
            'tanggal' => '2026-04-13',
            'kategori' => 'pengeluaran',
            'deskripsi' => 'default',
            'nominal' => 0,
        ], $overrides);

        $createdAt = $payload['created_at'] ?? null;
        $updatedAt = $payload['updated_at'] ?? null;

        unset($payload['created_at'], $payload['updated_at']);

        $transaction = Transaction::create($payload);

        if ($createdAt !== null || $updatedAt !== null) {
            $transaction->forceFill([
                'created_at' => $createdAt ?? $transaction->created_at,
                'updated_at' => $updatedAt ?? $transaction->updated_at,
            ])->save();
        }

        return $transaction->fresh();
    };

    $createTransaction([
        'amount' => 200000,
        'description' => 'Makan siang',
        'category' => 'makan',
        'type' => 'expense',
        'nominal' => 200000,
        'deskripsi' => 'Makan siang',
        'kategori' => 'pengeluaran',
        'updated_at' => Carbon::parse('2026-04-13 09:00:00'),
    ]);

    $createTransaction([
        'amount' => 700000,
        'description' => 'Gaji freelance',
        'category' => 'freelance',
        'type' => 'income',
        'nominal' => 700000,
        'deskripsi' => 'Gaji freelance',
        'kategori' => 'pemasukan',
        'updated_at' => Carbon::parse('2026-04-13 10:00:00'),
    ]);

    $response = getJson(
        "/api/service2/users/{$user->id}/transactions-feed",
        ['x-api-key' => 'service2-secret']
    );

    $response
        ->assertStatus(200)
        ->assertJsonPath('success', true)
        ->assertJsonPath('meta.sync_mode', 'snapshot')
        ->assertJsonPath('meta.user_id', $user->id)
        ->assertJsonPath('meta.total_items', 2)
        ->assertJsonPath('data.summary.total_income', 700000)
        ->assertJsonPath('data.summary.total_expense', 200000)
        ->assertJsonPath('data.summary.net_balance', 500000)
        ->assertJsonPath('data.summary.breakdown_category.makan.total_amount', 200000)
        ->assertJsonPath('data.summary.breakdown_category.freelance.total_amount', 700000)
        ->assertJsonCount(2, 'data.transactions');
});

it('returns delta feed when since is provided', function () {
    $user = User::factory()->create();

    $oldTransaction = Transaction::create([
        'user_id' => $user->id,
        'amount' => 15000,
        'description' => 'Parkir pagi',
        'category' => 'transport',
        'type' => 'expense',
        'transaction_date' => '2026-04-12',
        'tanggal' => '2026-04-12',
        'kategori' => 'pengeluaran',
        'deskripsi' => 'Parkir pagi',
        'nominal' => 15000,
    ]);

    $oldTransaction->forceFill([
        'updated_at' => Carbon::parse('2026-04-13 09:00:00'),
    ])->save();

    $newTransaction = Transaction::create([
        'user_id' => $user->id,
        'amount' => 25000,
        'description' => 'Beli bensin',
        'category' => 'transport',
        'type' => 'expense',
        'transaction_date' => '2026-04-13',
        'tanggal' => '2026-04-13',
        'kategori' => 'pengeluaran',
        'deskripsi' => 'Beli bensin',
        'nominal' => 25000,
    ]);

    $newTransaction->forceFill([
        'updated_at' => Carbon::parse('2026-04-13 12:00:00'),
    ])->save();

    $since = Carbon::parse('2026-04-13 10:00:00')->toIso8601String();
    $query = http_build_query([
        'since' => $since,
    ]);

    $response = getJson(
        "/api/service2/users/{$user->id}/transactions-feed?{$query}",
        ['x-api-key' => 'service2-secret']
    );

    $response
        ->assertStatus(200)
        ->assertJsonPath('success', true)
        ->assertJsonPath('meta.sync_mode', 'delta')
        ->assertJsonPath('meta.total_items', 1)
        ->assertJsonPath('data.transactions.0.id', $newTransaction->id);
});

it('returns unauthorized for invalid api key', function () {
    $user = User::factory()->create();

    $response = getJson(
        "/api/service2/users/{$user->id}/transactions-feed",
        ['x-api-key' => 'wrong-key']
    );

    $response
        ->assertStatus(401)
        ->assertJsonPath('success', false)
        ->assertJsonPath('message', 'Invalid service API key.');
});

it('returns bad request when since is invalid', function () {
    $user = User::factory()->create();

    $response = getJson(
        "/api/service2/users/{$user->id}/transactions-feed?since=not-a-date",
        ['x-api-key' => 'service2-secret']
    );

    $response
        ->assertStatus(400)
        ->assertJsonPath('success', false)
        ->assertJsonPath('message', 'Invalid request parameters.');
});

it('returns not found when user does not exist', function () {
    $response = getJson(
        '/api/service2/users/999999/transactions-feed',
        ['x-api-key' => 'service2-secret']
    );

    $response->assertStatus(404);
});

it('can skip summary when include_summary is false', function () {
    $user = User::factory()->create();

    Transaction::create([
        'user_id' => $user->id,
        'amount' => 10000,
        'description' => 'Tes transaksi',
        'category' => 'makan',
        'type' => 'expense',
        'transaction_date' => '2026-04-13',
        'tanggal' => '2026-04-13',
        'kategori' => 'pengeluaran',
        'deskripsi' => 'Tes transaksi',
        'nominal' => 10000,
    ]);

    $response = getJson(
        "/api/service2/users/{$user->id}/transactions-feed?include_summary=0",
        ['x-api-key' => 'service2-secret']
    );

    $response
        ->assertStatus(200)
        ->assertJsonPath('success', true)
        ->assertJsonMissingPath('data.summary')
        ->assertJsonPath('meta.total_items', 1);
});
