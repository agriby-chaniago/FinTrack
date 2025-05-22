<x-app-layout>
    <div class="space-y-6">

        <!-- Row 1: Two cards side by side -->
        <div class="grid grid-cols-1 md:grid-cols-2 mt-2 gap-6">

            <!-- Total Balance Card -->
            <div class="bg-raisin2 rounded-2xl p-8 m-2 shadow-md flex flex-col justify-between">
                <div class="flex items-center space-x-3">
                    <!-- Logo -->
                    <svg class="w-6 h-6 text-byzantine" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2a10 10 0 100 20 10 10 0 000-20zM10 17l6-5-6-5v10z" />
                    </svg>

                    <!-- Title -->
                    <h2 class="text-xs font-semibold uppercase text-byzantine tracking-wide">
                        TOTAL BALANCE
                    </h2>
                </div>

                <p class="text-4xl font-bold mt-4">
                    Rp.{{ number_format($remainingBalance, 2, '.', ',') }}
                </p>

                <!-- Income & Expense -->
                <div class="flex space-x-6 items-center mt-6">

                    <!-- Income -->
                    <div class="flex items-center space-x-3 text-[#A8E6CF]">
                        <!-- Icon income: Arrow Trending Up -->
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
                            <path fill-rule="evenodd" d="M15.22 6.268a.75.75 0 0 1 .968-.431l5.942 2.28a.75.75 0 0 1 .431.97l-2.28 5.94a.75.75 0 1 1-1.4-.537l1.63-4.251-1.086.484a11.2 11.2 0 0 0-5.45 5.173.75.75 0 0 1-1.199.19L9 12.312l-6.22 6.22a.75.75 0 0 1-1.06-1.061l6.75-6.75a.75.75 0 0 1 1.06 0l3.606 3.606a12.695 12.695 0 0 1 5.68-4.974l1.086-.483-4.251-1.632a.75.75 0 0 1-.432-.97Z" clip-rule="evenodd" />
                        </svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-semibold">
                                Rp.{{ number_format($totalIncome, 2, '.', ',') }}
                                <span class="text-xs text-platinum pl-2">Income</span>
                            </span>
                        </div>
                    </div>

                    <!-- Expense -->
                    <div class="flex items-center space-x-3 text-[#FF8B94]">
                        <!-- Icon expense: Arrow Trending Down -->
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
                            <path fill-rule="evenodd" d="M1.72 5.47a.75.75 0 0 1 1.06 0L9 11.69l3.756-3.756a.75.75 0 0 1 .985-.066 12.698 12.698 0 0 1 4.575 6.832l.308 1.149 2.277-3.943a.75.75 0 1 1 1.299.75l-3.182 5.51a.75.75 0 0 1-1.025.275l-5.511-3.181a.75.75 0 0 1 .75-1.3l3.943 2.277-.308-1.149a11.194 11.194 0 0 0-3.528-5.617l-3.809 3.81a.75.75 0 0 1-1.06 0L1.72 6.53a.75.75 0 0 1 0-1.061Z" clip-rule="evenodd" />
                        </svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-semibold">
                                Rp.{{ number_format($totalExpense, 2, '.', ',') }}
                                <span class="text-xs text-platinum pl-2">Expense</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Quick Add Transaction Card -->
            <div class="bg-raisin2 rounded-2xl p-8 m-2 shadow-md">
                <h2 class="text-lg font-semibold mb-4 flex items-center space-x-2 text-white">
                    <!-- Ikon Plus -->
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-byzantine" viewBox="0 0 24 24" fill="currentColor">
                        <path fill-rule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v8.25h8.25a.75.75 0 0 1 0 1.5H12.75v8.25a.75.75 0 0 1-1.5 0V12.75H3a.75.75 0 0 1 0-1.5h8.25V3a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
                    </svg>
                    <span>Quick Add Transaction</span>
                </h2>
                <form action="{{ route('transactions.store') }}" method="POST" class="space-y-4">
                    @csrf
                    <!-- User ID (otomatis, hidden jika ambil dari auth) -->
                    <input type="hidden" name="user_id" value="{{ auth()->user()->id }}">

                    <!-- Baris Nominal & Kategori -->
                    <div class="flex flex-col md:flex-row gap-4">
                        <!-- Nominal -->
                        <input
                            type="number"
                            name="nominal"
                            placeholder="Nominal"
                            class="w-full md:w-1/2 p-3 rounded-lg bg-raisin border border-gray-700 text-platinum focus:outline-none focus:ring-2 focus:ring-byzantine"
                            style="appearance: none; -moz-appearance: textfield; -webkit-appearance: none; margin: 0;"
                            required>

                        <!-- Kategori -->
                        <select
                            name="kategori"
                            class="w-full md:w-1/2 p-3 rounded-lg bg-raisin border border-gray-700 text-platinum focus:outline-none focus:ring-2 focus:ring-byzantine"
                            required>
                            <option value="" disabled selected>Pilih Kategori</option>
                            <option value="pemasukan">Income</option>
                            <option value="pengeluaran">Expense</option>
                        </select>
                    </div>

                    <!-- Tanggal -->
                    <input
                        type="date"
                        name="tanggal"
                        class="w-full p-3 rounded-lg bg-raisin border border-gray-700 text-platinum focus:outline-none focus:ring-2 focus:ring-byzantine"
                        value="{{ \Carbon\Carbon::now()->toDateString() }}"
                        required>

                    <!-- Deskripsi -->
                    <input
                        type="text"
                        name="deskripsi"
                        placeholder="Deskripsi"
                        class="w-full p-3 rounded-lg bg-raisin border border-gray-700 text-platinum focus:outline-none focus:ring-2 focus:ring-byzantine"
                        required>

                    <!-- Tombol Submit -->
                    <button
                        type="submit"
                        class="w-full p-3 bg-byzantine hover:bg-raisin hover:text-byzantine text-raisin font-semibold rounded-lg shadow transition duration-200">
                        Add Transaction
                    </button>
                </form>
            </div>
        </div>

        <!-- Row 2: Chart Card -->
        <div class="bg-raisin2 rounded-2xl p-8 m-2 mt-2 shadow-md">
            <h2 class="text-lg font-semibold mb-4">Weekly Overview</h2>
            <div id="spline-chart"></div>
        </div>
        <br>

        <!-- Transaction History -->
        <h2 class="text-lg font-semibold mb-4 text-platinum pl-2">Transaction History</h2>
        <div x-data="transactionHistory()" class="bg-raisin2 rounded-2xl p-6 m-2 mt-4 shadow-md text-platinum">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="border-b border-raisin">
                        <th class="py-3 px-4 font-medium tracking-wide">Tanggal</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Kategori</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Nominal</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Deskripsi</th>
                    </tr>
                </thead>
                <tbody>
                    <template x-for="(tx, index) in transactions" :key="index">
                        <tr class="border-b border-raisin hover:bg-raisin transition-colors duration-200">
                            <td class="py-3 px-4" x-text="tx.tanggal"></td>
                            <td class="py-3 px-4">
                                <span
                                    :class="tx.kategori === 'pemasukan' ? 'text-[#A8E6CF]' : 'text-[#FF8B94]'"
                                    x-text="tx.kategori.charAt(0).toUpperCase() + tx.kategori.slice(1)">
                                </span>
                            </td>
                            <td class="py-3 px-4 font-mono" x-text="formatCurrency(tx.nominal)"></td>
                            <td class="py-3 px-4" x-text="tx.deskripsi"></td>
                        </tr>
                    </template>
                    <template x-if="transactions.length === 0">
                        <tr>
                            <td colspan="4" class="py-6 text-center text-platinum/70 italic">
                                No transactions found.
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div><br>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 m-2">
            <!-- Kiri: Judul & Bar Chart -->
            <div class="bg-raisin2 rounded-2xl p-6 shadow-md text-platinum">
                <h1 class="text-xl font-semibold mb-2">Income vs Expenses</h1>
                <p class="text-sm text-gray-400 mb-4"></p>
                <div id="bar-chart" class="h-64"></div>
            </div>

            <!-- Kanan: 3 Card Vertikal, tinggi sama dengan div kiri -->
            <div class="flex flex-col gap-6 h-full">
                <!-- Card: Total Income -->
                <div class="flex-grow bg-raisin2 rounded-2xl p-4 shadow-md flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-[#A8E6CF] p-3 rounded-full">
                            <svg class="w-6 h-6 text-night" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M11 17a1 1 0 01-1 1H6a1 1 0 010-2h4a1 1 0 011 1zM9 2a7 7 0 100 14 7 7 0 000-14zM3 9a6 6 0 1112 0A6 6 0 013 9z" />
                            </svg>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-sm text-gray-400">Total Income</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-lg font-semibold text-[#A8E6CF]">Rp {{ number_format($totalIncome, 0, ',', '.') }}</span>
                    </div>
                </div>

                <!-- Card: Total Expense -->
                <div class="flex-grow bg-raisin2 rounded-2xl p-4 shadow-md flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-[#FF8B94] p-3 rounded-full">
                            <svg class="w-6 h-6 text-night" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9 2a7 7 0 100 14A7 7 0 009 2zm0 12a5 5 0 110-10 5 5 0 010 10z" />
                            </svg>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-sm text-gray-400">Total Expense</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-lg font-semibold text-[#FF8B94]">Rp {{ number_format($totalExpense, 0, ',', '.') }}</span>
                    </div>
                </div>

                <!-- Card: Net Savings -->
                <div class="flex-grow bg-raisin2 rounded-2xl p-4 shadow-md flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="bg-[#FFD3B6] p-3 rounded-full">
                            <svg class="w-6 h-6 text-night" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M5 3a1 1 0 100 2h10a1 1 0 100-2H5zM5 7a1 1 0 100 2h10a1 1 0 100-2H5zM5 11a1 1 0 100 2h10a1 1 0 100-2H5z" />
                            </svg>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-sm text-gray-400">Net Savings</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-lg font-semibold text-[#FFD3B6]">Rp {{ number_format($remainingBalance, 0, ',', '.') }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        function transactionHistory() {
            return {
                transactions: @json($transactions),
                formatCurrency(value) {
                    return new Intl.NumberFormat('id-ID', {
                        style: 'currency',
                        currency: 'IDR',
                        minimumFractionDigits: 0
                    }).format(value);
                }
            }
        }
    </script>

    <!-- ApexCharts Script -->
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const incomeData = @json($incomeSeries);
            const expenseData = @json($expenseSeries);
            const categories = @json($daysFormatted);

            const options = {
                chart: {
                    type: 'area',
                    height: 310,
                    toolbar: {
                        show: false
                    },
                    foreColor: '#EEEEEE'
                },
                series: [{
                        name: 'Income',
                        data: incomeData
                    },
                    {
                        name: 'Expense',
                        data: expenseData
                    }
                ],
                xaxis: {
                    categories: categories
                },
                stroke: {
                    curve: 'smooth',
                    width: 2
                },
                fill: {
                    type: 'gradient',
                    gradient: {
                        shadeIntensity: 1,
                        opacityFrom: 0.6,
                        opacityTo: 0.1,
                        stops: [0, 90, 100]
                    }
                },
                colors: ['#4FC3F7', '#EF5350'],
                grid: {
                    borderColor: '#2a2a2a',
                    strokeDashArray: 4
                },
                tooltip: {
                    theme: 'dark'
                },
                legend: {
                    labels: {
                        colors: '#EEEEEE'
                    }
                },
                dataLabels: {
                    enabled: false
                }
            };

            const chart = new ApexCharts(document.querySelector("#spline-chart"), options);
            chart.render();
        });
    </script>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const incomeData = @json($incomeSeries);
            const expenseData = @json($expenseSeries);
            const categories = @json($daysFormatted); // sudah diformat di controller

            const options = {
                chart: {
                    type: 'bar',
                    height: 310,
                    toolbar: {
                        show: false
                    },
                    foreColor: '#EEEEEE'
                },
                series: [{
                        name: 'Income',
                        data: incomeData
                    },
                    {
                        name: 'Expense',
                        data: expenseData
                    }
                ],
                xaxis: {
                    categories: categories,
                    labels: {
                        style: {
                            colors: '#EEEEEE'
                        }
                    }
                },
                plotOptions: {
                    bar: {
                        horizontal: false,
                        columnWidth: '50%',
                        endingShape: 'rounded'
                    }
                },
                stroke: {
                    show: true,
                    width: 2,
                    colors: ['transparent']
                },
                fill: {
                    opacity: 1
                },
                colors: ['#4FC3F7', '#EF5350'],
                grid: {
                    borderColor: '#2a2a2a',
                    strokeDashArray: 4
                },
                tooltip: {
                    theme: 'dark'
                },
                legend: {
                    labels: {
                        colors: '#EEEEEE'
                    }
                },
                dataLabels: {
                    enabled: false
                }
            };

            const chart = new ApexCharts(document.querySelector("#bar-chart"), options);
            chart.render();
        });
    </script>
</x-app-layout>
