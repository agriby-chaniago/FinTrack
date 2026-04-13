<x-app-layout>
    <div class="mx-auto py-12 px-6 max-w-7xl font-sans animate-fadeIn">

        <h2 class="text-lg font-semibold mb-4 text-platinum pl-2 tracking-wide">Riwayat Transaksi</h2>

        {{-- Simpan data transaksi secara aman di sini --}}
        <script id="transactions-data" type="application/json">
            {!! json_encode($transactions, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT) !!}
        </script>

        <div
            x-data="{
                search: '',
                transactions: [],

                normalizeDescription(transaction) {
                    return (transaction.description ?? transaction.deskripsi ?? '').toString();
                },
                normalizeType(transaction) {
                    if (transaction.type) return transaction.type;
                    if (transaction.kategori === 'pemasukan') return 'income';
                    if (transaction.kategori === 'pengeluaran') return 'expense';

                    return '';
                },
                normalizeTransactionCategory(transaction) {
                    const type = this.normalizeType(transaction);

                    if (type === 'income') {
                        return 'pemasukan';
                    }

                    if (type === 'expense') {
                        return 'pengeluaran';
                    }

                    return (transaction.kategori ?? '').toString().toLowerCase();
                },
                normalizeAiCategory(transaction) {
                    const value = (transaction.category ?? '').toString().trim();

                    return value !== '' ? value : 'lainnya';
                },
                normalizeAmount(transaction) {
                    return Number(transaction.amount ?? transaction.nominal ?? 0);
                },
                normalizeDate(transaction) {
                    return transaction.transaction_date ?? transaction.tanggal ?? '-';
                },
                formatDate(value) {
                    if (!value || value === '-') {
                        return '-';
                    }

                    const parsed = new Date(value);

                    if (!Number.isNaN(parsed.getTime())) {
                        return new Intl.DateTimeFormat('id-ID', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                        }).format(parsed);
                    }

                    const fallback = value.toString();

                    return fallback.includes('T') ? fallback.split('T')[0] : fallback;
                },

                get filteredTransactions() {
                    const keyword = this.search.toLowerCase();

                    return this.transactions.filter(transaction => {
                        const description = this.normalizeDescription(transaction).toLowerCase();
                        const transactionCategory = this.normalizeTransactionCategory(transaction).toLowerCase();
                        const aiCategory = this.normalizeAiCategory(transaction).toLowerCase();
                        const type = this.normalizeType(transaction).toLowerCase();

                        return description.includes(keyword)
                            || transactionCategory.includes(keyword)
                            || aiCategory.includes(keyword)
                            || type.includes(keyword);
                    });
                },
                formatCurrency(value) {
                    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(value);
                },
                formatTransactionCategory(transaction) {
                    const category = this.normalizeTransactionCategory(transaction);

                    if (category === '') {
                        return '-';
                    }

                    if (category === 'pemasukan') {
                        return 'Pemasukan';
                    }

                    if (category === 'pengeluaran') {
                        return 'Pengeluaran';
                    }

                    return category.charAt(0).toUpperCase() + category.slice(1);
                },
                formatAiCategory(transaction) {
                    const category = this.normalizeAiCategory(transaction);

                    return category
                        .split(' ')
                        .filter(Boolean)
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                },
                transactionCategoryColorClass(transaction) {
                    const type = this.normalizeType(transaction);

                    if (type === 'income') {
                        return 'text-green-400';
                    }

                    if (type === 'expense') {
                        return 'text-red-400';
                    }

                    return 'text-platinum';
                },
                aiCategoryColorClass(transaction) {
                    const type = this.normalizeType(transaction);

                    if (type === 'income') {
                        return 'text-cyan-300';
                    }

                    if (type === 'expense') {
                        return 'text-yellow-300';
                    }

                    return 'text-platinum/70';
                },
                init() {
                    const parsed = JSON.parse(document.getElementById('transactions-data').textContent);
                    this.transactions = Array.isArray(parsed) ? parsed : [];
                }
            }"
            x-init="init()"
            class="bg-raisin2 rounded-2xl p-6 m-2 mt-4 shadow-md text-platinum"
        >
            <input
                type="text"
                x-model="search"
                placeholder="Cari deskripsi atau kategori..."
                class="mb-4 w-full max-w-sm rounded-lg border border-gray-600 bg-transparent px-4 py-2 text-platinum placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-byzantine focus:border-byzantine transition"
            />

            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="border-b border-raisin">
                        <th class="py-3 px-4 font-medium tracking-wide">Tanggal</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Kategori Transaksi</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Kategori AI (Groq)</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Nominal</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Deskripsi</th>
                        <th class="py-3 px-4 font-medium tracking-wide text-center">Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    <template x-for="transaction in filteredTransactions" :key="transaction.id">
                        <tr class="border-b border-raisin hover:bg-raisin transition-colors duration-200">
                            <td class="py-3 px-4" x-text="formatDate(normalizeDate(transaction))"></td>
                            <td class="py-3 px-4">
                                <span
                                    :class="transactionCategoryColorClass(transaction)"
                                    x-text="formatTransactionCategory(transaction)"
                                ></span>
                            </td>
                            <td class="py-3 px-4">
                                <span
                                    :class="aiCategoryColorClass(transaction)"
                                    x-text="formatAiCategory(transaction)"
                                ></span>
                            </td>
                            <td class="py-3 px-4 font-mono" x-text="formatCurrency(normalizeAmount(transaction))"></td>
                            <td class="py-3 px-4" x-text="normalizeDescription(transaction)"></td>
                            <td class="py-3 px-4 text-center space-x-2">
                                <a
                                    :href="`/transactions/${transaction.id}/edit`"
                                    class="text-yellow-400 hover:underline text-sm"
                                >Edit</a>
                                <form :action="`/transactions/${transaction.id}`" method="POST" class="inline">
                                    @csrf
                                    @method('DELETE')
                                    <button type="submit" onclick="return confirm('Yakin hapus transaksi ini?')"
                                        class="text-red-400 hover:underline text-sm"
                                    >Hapus</button>
                                </form>
                            </td>
                        </tr>
                    </template>
                    <template x-if="filteredTransactions.length === 0">
                        <tr>
                            <td colspan="6" class="py-6 text-center text-platinum/70 italic">
                                Tidak ada transaksi ditemukan.
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
    </div>
</x-app-layout>
