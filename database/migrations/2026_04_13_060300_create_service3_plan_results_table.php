<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('service3_plan_results', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('correlation_id')->unique();
            $table->string('analysis_id')->nullable();
            $table->enum('status', ['success', 'failed'])->default('success');
            $table->text('summary_text')->nullable();
            $table->json('recommendations')->nullable();
            $table->json('goals')->nullable();
            $table->json('raw_payload');
            $table->date('plan_period_start')->nullable();
            $table->date('plan_period_end')->nullable();
            $table->unsignedInteger('attempt_count')->default(1);
            $table->timestamp('last_attempted_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at'], 'service3_results_user_created_idx');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('service3_plan_results');
    }
};
