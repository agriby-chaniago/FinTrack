<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Transaction extends Model
{
    // Kolom yang boleh diisi mass assignment
    protected $fillable = [
        'user_id',
        'tanggal',
        'kategori',
        'deskripsi',
        'nominal',
    ];

    // Relasi ke User (asumsi model User standar Laravel)
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
