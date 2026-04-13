<x-app-layout>
    @php
        $hasSearch = $filters['search'] !== '';
        $lastUpdatedAt = $stats['last_updated_at'] ?? null;
        $lastUpdatedText = $lastUpdatedAt ? $lastUpdatedAt->format('d M Y, H:i') : '-';
        $lastUpdatedHuman = $lastUpdatedAt ? $lastUpdatedAt->diffForHumans() : 'belum tersedia';

        $latestRecommendations = collect($latestPlan?->recommendations ?? []);
        $latestGoals = collect($latestPlan?->goals ?? []);
    @endphp

    <div class="space-y-6 animate-fadeIn">
        <section class="relative overflow-hidden rounded-2xl border border-white/5 bg-raisin2 p-6 shadow-md">
            <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-byzantine/20 via-[#4FC3F7]/10 to-transparent"></div>

            <div class="relative">
                <p class="text-xs uppercase tracking-[0.2em] text-platinum/55">AI Planner</p>
                <h1 class="text-2xl font-semibold mt-2">Rencana Keuangan Kamu</h1>
                <p class="text-sm text-platinum/70 mt-2 max-w-3xl leading-relaxed">
                    Halaman ini menampilkan hasil rencana yang sudah siap dipakai, lengkap dengan saran tindakan dan target keuangan dari planner.
                </p>

                <div class="mt-4 flex flex-wrap items-center gap-2">
                    <span class="inline-flex items-center rounded-full border border-[#A8E6CF]/35 bg-[#A8E6CF]/20 px-3 py-1 text-xs font-semibold text-[#A8E6CF]">
                        {{ number_format((int) ($stats['total_plans'] ?? 0)) }} rencana tersedia
                    </span>
                    <span class="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-platinum/80">
                        Diperbarui {{ $lastUpdatedHuman }}
                    </span>
                </div>
            </div>
        </section>

        <section class="bg-raisin2 rounded-2xl p-5 shadow-md border border-white/5">
            <form method="GET" action="{{ route('service3.plans.index') }}" class="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                <label for="search" class="text-sm text-platinum/75">
                    Cari rencana berdasarkan ringkasan:
                </label>

                <div class="w-full md:max-w-2xl flex gap-2">
                    <input
                        id="search"
                        type="text"
                        name="search"
                        value="{{ $filters['search'] }}"
                        placeholder="Contoh: dana darurat, investasi, cicilan"
                        class="w-full rounded-lg bg-raisin border border-white/10 text-platinum px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-byzantine"
                    >
                    <button
                        type="submit"
                        class="rounded-lg bg-byzantine text-raisin font-semibold px-4 py-2.5 hover:bg-platinum hover:text-night transition"
                    >
                        Cari
                    </button>

                    @if($hasSearch)
                        <a
                            href="{{ route('service3.plans.index') }}"
                            class="inline-flex items-center rounded-lg border border-white/20 px-3 py-2.5 text-sm text-platinum/85 hover:bg-white/5 transition"
                        >
                            Reset
                        </a>
                    @endif
                </div>
            </form>
        </section>

        @if(! $latestPlan)
            <section class="bg-raisin2 rounded-2xl p-8 shadow-md border border-white/5 text-center">
                <h2 class="text-xl font-semibold">Rencana Belum Tersedia</h2>
                <p class="text-sm text-platinum/70 mt-2 max-w-2xl mx-auto leading-relaxed">
                    Belum ada hasil rencana yang siap ditampilkan. Setelah planner selesai memproses data, ringkasan rencana dan target keuangan akan muncul otomatis di halaman ini.
                </p>
            </section>
        @else
            <section class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <article class="xl:col-span-2 bg-raisin2 rounded-2xl p-6 shadow-md border border-white/5">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <h2 class="text-lg font-semibold">Ringkasan Rencana Terbaru</h2>
                        <span class="text-xs text-platinum/65">Update: {{ $lastUpdatedText }}</span>
                    </div>

                    <div class="rounded-xl bg-raisin border border-white/5 p-4">
                        <p class="text-base leading-relaxed">{{ $latestPlan->summary_text ?: 'Ringkasan rencana belum tersedia.' }}</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div class="rounded-xl border border-white/5 bg-raisin p-4">
                            <p class="text-xs uppercase tracking-wide text-platinum/60">Saran Utama Dari Planner</p>
                            @if($latestRecommendations->isEmpty())
                                <p class="mt-2 text-sm text-platinum/70">Belum ada saran utama untuk rencana ini.</p>
                            @else
                                <ul class="mt-2 space-y-2 text-sm">
                                    @foreach($latestRecommendations->take(5) as $recommendation)
                                        @php
                                            $label = (string) ($recommendation['product'] ?? $recommendation['name'] ?? $recommendation['type'] ?? 'Saran');
                                            $allocation = $recommendation['allocation'] ?? null;
                                        @endphp
                                        <li class="rounded-lg bg-night/30 border border-white/5 px-3 py-2 flex items-center justify-between gap-3">
                                            <span>{{ $label }}</span>
                                            @if(is_numeric($allocation))
                                                <span class="text-[#4FC3F7] font-semibold">{{ (int) $allocation }}%</span>
                                            @endif
                                        </li>
                                    @endforeach
                                </ul>
                            @endif
                        </div>

                        <div class="rounded-xl border border-white/5 bg-raisin p-4">
                            <p class="text-xs uppercase tracking-wide text-platinum/60">Target Keuangan</p>
                            @if($latestGoals->isEmpty())
                                <p class="mt-2 text-sm text-platinum/70">Belum ada target keuangan pada rencana ini.</p>
                            @else
                                <div class="mt-2 space-y-2">
                                    @foreach($latestGoals->take(5) as $goal)
                                        <div class="rounded-lg bg-night/30 border border-white/5 px-3 py-2">
                                            <p class="font-medium text-sm">{{ (string) ($goal['name'] ?? 'Target') }}</p>
                                            <p class="text-xs text-platinum/70 mt-1">
                                                Target: Rp {{ number_format((float) ($goal['target'] ?? 0), 0, ',', '.') }}
                                            </p>
                                            <p class="text-xs text-platinum/70">
                                                Waktu: {{ (int) ($goal['timeline_months'] ?? 0) }} bulan
                                            </p>
                                        </div>
                                    @endforeach
                                </div>
                            @endif
                        </div>
                    </div>
                </article>

                <aside class="bg-raisin2 rounded-2xl p-6 shadow-md border border-white/5">
                    <h2 class="text-lg font-semibold mb-3">Sekilas</h2>
                    <div class="space-y-3 text-sm">
                        <div class="bg-raisin rounded-lg p-3 border border-white/5">
                            <p class="text-platinum/60 text-xs uppercase tracking-wide">Total Rencana Siap Dipakai</p>
                            <p class="mt-1 text-lg font-semibold">{{ number_format((int) ($stats['total_plans'] ?? 0)) }}</p>
                        </div>
                        <div class="bg-raisin rounded-lg p-3 border border-white/5">
                            <p class="text-platinum/60 text-xs uppercase tracking-wide">Jumlah Saran Di Rencana Terbaru</p>
                            <p class="mt-1 text-lg font-semibold">{{ number_format((int) ($stats['latest_recommendations'] ?? 0)) }}</p>
                        </div>
                        <div class="bg-raisin rounded-lg p-3 border border-white/5">
                            <p class="text-platinum/60 text-xs uppercase tracking-wide">Jumlah Target Di Rencana Terbaru</p>
                            <p class="mt-1 text-lg font-semibold">{{ number_format((int) ($stats['latest_goals'] ?? 0)) }}</p>
                        </div>
                    </div>
                </aside>
            </section>

            <section class="bg-raisin2 rounded-2xl p-6 shadow-md border border-white/5">
                <div class="flex items-center justify-between gap-3 mb-4">
                    <h2 class="text-lg font-semibold">Riwayat Rencana</h2>
                    <p class="text-xs text-platinum/60">Semua data di bawah berasal dari hasil planner yang sukses.</p>
                </div>

                @if($plans->isEmpty())
                    <p class="text-platinum/70">Tidak ada rencana yang sesuai dengan pencarian.</p>
                @else
                    <div class="space-y-3">
                        @foreach($plans as $plan)
                            @php
                                $planRecommendations = collect($plan->recommendations ?? []);
                                $planGoals = collect($plan->goals ?? []);
                            @endphp

                            <details class="group bg-raisin rounded-xl border border-white/5 p-4 transition hover:border-white/15">
                                <summary class="list-none cursor-pointer">
                                    <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                        <div>
                                            <p class="font-medium leading-relaxed">{{ $plan->summary_text ?: 'Ringkasan belum tersedia.' }}</p>
                                            <div class="mt-2 flex flex-wrap gap-2 text-xs text-platinum/65">
                                                <span>{{ $plan->created_at?->format('d M Y, H:i') ?? '-' }}</span>
                                                <span class="text-platinum/40">•</span>
                                                <span>{{ $planRecommendations->count() }} saran</span>
                                                <span class="text-platinum/40">•</span>
                                                <span>{{ $planGoals->count() }} target</span>
                                            </div>
                                        </div>
                                        <span class="inline-flex items-center rounded-full border border-[#A8E6CF]/35 bg-[#A8E6CF]/20 px-3 py-1 text-xs font-semibold text-[#A8E6CF]">
                                            Siap Dipakai
                                        </span>
                                    </div>
                                </summary>

                                <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                    <div class="bg-night/30 rounded-lg p-3 border border-white/5">
                                        <p class="text-xs uppercase tracking-wide text-platinum/60">Saran Planner</p>
                                        @if($planRecommendations->isEmpty())
                                            <p class="mt-2 text-platinum/70">Tidak ada saran tambahan.</p>
                                        @else
                                            <ul class="mt-2 space-y-1">
                                                @foreach($planRecommendations as $rec)
                                                    <li>
                                                        - {{ (string) ($rec['product'] ?? $rec['name'] ?? $rec['type'] ?? 'Saran') }}
                                                        @if(isset($rec['allocation']) && is_numeric($rec['allocation']))
                                                            ({{ (int) $rec['allocation'] }}%)
                                                        @endif
                                                    </li>
                                                @endforeach
                                            </ul>
                                        @endif
                                    </div>

                                    <div class="bg-night/30 rounded-lg p-3 border border-white/5">
                                        <p class="text-xs uppercase tracking-wide text-platinum/60">Target Keuangan</p>
                                        @if($planGoals->isEmpty())
                                            <p class="mt-2 text-platinum/70">Tidak ada target tambahan.</p>
                                        @else
                                            <ul class="mt-2 space-y-1">
                                                @foreach($planGoals as $goal)
                                                    <li>
                                                        - {{ (string) ($goal['name'] ?? 'Target') }}
                                                        (Rp {{ number_format((float) ($goal['target'] ?? 0), 0, ',', '.') }},
                                                        {{ (int) ($goal['timeline_months'] ?? 0) }} bulan)
                                                    </li>
                                                @endforeach
                                            </ul>
                                        @endif
                                    </div>
                                </div>
                            </details>
                        @endforeach
                    </div>

                    <div class="mt-6">
                        {{ $plans->onEachSide(1)->links() }}
                    </div>
                @endif
            </section>
        @endif
    </div>
</x-app-layout>
