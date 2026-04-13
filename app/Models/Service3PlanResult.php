<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Service3PlanResult extends Model
{
    protected $fillable = [
        'user_id',
        'correlation_id',
        'analysis_id',
        'status',
        'summary_text',
        'recommendations',
        'goals',
        'raw_payload',
        'plan_period_start',
        'plan_period_end',
        'attempt_count',
        'last_attempted_at',
    ];

    protected $casts = [
        'recommendations' => 'array',
        'goals' => 'array',
        'raw_payload' => 'array',
        'plan_period_start' => 'date',
        'plan_period_end' => 'date',
        'last_attempted_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
