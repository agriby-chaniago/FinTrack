<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->unsignedBigInteger('amount')->nullable();
            $table->string('description')->nullable();
            $table->string('category', 100)->nullable();
            $table->enum('type', ['income', 'expense'])->nullable();
            $table->date('transaction_date')->nullable();
            $table->index(['user_id', 'transaction_date'], 'transactions_user_transaction_date_idx');
        });

        DB::table('transactions')
            ->whereNull('amount')
            ->update([
                'amount' => DB::raw('nominal'),
                'description' => DB::raw('deskripsi'),
                'category' => DB::raw("CASE WHEN kategori = 'pemasukan' THEN 'income' ELSE 'expense' END"),
                'type' => DB::raw("CASE WHEN kategori = 'pemasukan' THEN 'income' ELSE 'expense' END"),
                'transaction_date' => DB::raw('tanggal'),
            ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropIndex('transactions_user_transaction_date_idx');
            $table->dropColumn([
                'amount',
                'description',
                'category',
                'type',
                'transaction_date',
            ]);
        });
    }
};
