<?php

use App\Http\Controllers\ProfileController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\StatsController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Dashboard route (dengan total pemasukan/pengeluaran)
Route::get('/dashboard', [TransactionController::class, 'dashboard'])
    ->middleware(['auth', 'verified'])
    ->name('dashboard');

// Group semua route yang memerlukan autentikasi
Route::middleware('auth')->group(function () {

    // Profile user
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    // Transaksi (CRUD via controller resource)
    Route::resource('transactions', TransactionController::class);

    // Alias untuk halaman riwayat transaksi
    Route::get('/history', [TransactionController::class, 'index'])->name('history.index');

    Route::get('/stats', [StatsController::class, 'index'])->name('stats.index');
});

require __DIR__.'/auth.php';
