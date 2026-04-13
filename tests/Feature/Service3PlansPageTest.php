<?php

use App\Models\Service3PlanResult;
use App\Models\User;
use function Pest\Laravel\actingAs;
use function Pest\Laravel\get;

test('service3 plans page requires authentication', function () {
    get('/service3/plans')->assertRedirect('/login');
});

test('service3 plans page shows only authenticated user records', function () {
    /** @var User $owner */
    $owner = User::factory()->createOne();
    /** @var User $other */
    $other = User::factory()->createOne();

    Service3PlanResult::create([
        'user_id' => $owner->id,
        'correlation_id' => 'corr-owner-001',
        'analysis_id' => 'analysis-owner-001',
        'status' => 'success',
        'summary_text' => 'Owner summary should be visible',
        'recommendations' => [['name' => 'Owner Rec']],
        'goals' => [['name' => 'Owner Goal']],
        'raw_payload' => ['source' => 'service3'],
        'attempt_count' => 1,
        'last_attempted_at' => now(),
    ]);

    Service3PlanResult::create([
        'user_id' => $other->id,
        'correlation_id' => 'corr-other-001',
        'analysis_id' => 'analysis-other-001',
        'status' => 'success',
        'summary_text' => 'Other summary should be hidden',
        'recommendations' => [['name' => 'Other Rec']],
        'goals' => [['name' => 'Other Goal']],
        'raw_payload' => ['source' => 'service3'],
        'attempt_count' => 1,
        'last_attempted_at' => now(),
    ]);

    actingAs($owner);

    $response = get('/service3/plans');

    $response
        ->assertOk()
        ->assertSee('Owner summary should be visible')
        ->assertDontSee('Other summary should be hidden')
        ->assertSee('Siap Dipakai');
});

test('service3 plans page hides failed plans by default', function () {
    /** @var User $user */
    $user = User::factory()->createOne();

    Service3PlanResult::create([
        'user_id' => $user->id,
        'correlation_id' => 'corr-filter-success',
        'analysis_id' => 'analysis-filter-success',
        'status' => 'success',
        'summary_text' => 'Dana darurat aman',
        'recommendations' => [['name' => 'Rec A']],
        'goals' => [['name' => 'Goal A']],
        'raw_payload' => ['source' => 'service3'],
        'attempt_count' => 1,
        'last_attempted_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    Service3PlanResult::create([
        'user_id' => $user->id,
        'correlation_id' => 'corr-filter-failed',
        'analysis_id' => 'analysis-filter-failed',
        'status' => 'failed',
        'summary_text' => 'Target belum tercapai',
        'recommendations' => [['name' => 'Rec B']],
        'goals' => [['name' => 'Goal B']],
        'raw_payload' => ['source' => 'service3'],
        'attempt_count' => 1,
        'last_attempted_at' => now(),
        'created_at' => now()->subDay(),
        'updated_at' => now()->subDay(),
    ]);

    actingAs($user);

    $response = get('/service3/plans');

    $response
        ->assertOk()
        ->assertSee('Dana darurat aman')
        ->assertDontSee('Target belum tercapai');
});

test('service3 plans page filters by summary search', function () {
    /** @var User $user */
    $user = User::factory()->createOne();

    Service3PlanResult::create([
        'user_id' => $user->id,
        'correlation_id' => 'corr-search-001',
        'analysis_id' => 'analysis-search-001',
        'status' => 'success',
        'summary_text' => 'Fokus dana darurat keluarga',
        'recommendations' => [['name' => 'Rec Darurat']],
        'goals' => [['name' => 'Goal Darurat']],
        'raw_payload' => ['source' => 'service3'],
        'attempt_count' => 1,
        'last_attempted_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    Service3PlanResult::create([
        'user_id' => $user->id,
        'correlation_id' => 'corr-search-002',
        'analysis_id' => 'analysis-search-002',
        'status' => 'success',
        'summary_text' => 'Rencana liburan tahunan',
        'recommendations' => [['name' => 'Rec Liburan']],
        'goals' => [['name' => 'Goal Liburan']],
        'raw_payload' => ['source' => 'service3'],
        'attempt_count' => 1,
        'last_attempted_at' => now(),
        'created_at' => now()->subMinute(),
        'updated_at' => now()->subMinute(),
    ]);

    actingAs($user);

    get('/service3/plans?search=darurat')
        ->assertOk()
        ->assertSee('Fokus dana darurat keluarga')
        ->assertDontSee('Rencana liburan tahunan');
});
