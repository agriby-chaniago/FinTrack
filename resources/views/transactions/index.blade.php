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

                get filteredTransactions() {
                    return this.transactions.filter(t =>
                        t.deskripsi.toLowerCase().includes(this.search.toLowerCase()) ||
                        t.kategori.toLowerCase().includes(this.search.toLowerCase())
                    );
                },
                formatCurrency(value) {
                    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(value);
                },
                formatKategori(kategori) {
                    return kategori === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran';
                },
                init() {
                    this.transactions = JSON.parse(document.getElementById('transactions-data').textContent);
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
                        <th class="py-3 px-4 font-medium tracking-wide">Kategori</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Nominal</th>
                        <th class="py-3 px-4 font-medium tracking-wide">Deskripsi</th>
                        <th class="py-3 px-4 font-medium tracking-wide text-center">Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    <template x-for="transaction in filteredTransactions" :key="transaction.id">
                        <tr class="border-b border-raisin hover:bg-raisin transition-colors duration-200">
                            <td class="py-3 px-4" x-text="transaction.tanggal"></td>
                            <td class="py-3 px-4">
                                <span
                                    :class="transaction.kategori === 'pemasukan' ? 'text-green-400' : 'text-red-400'"
                                    x-text="formatKategori(transaction.kategori)"
                                ></span>
                            </td>
                            <td class="py-3 px-4 font-mono" x-text="formatCurrency(transaction.nominal)"></td>
                            <td class="py-3 px-4" x-text="transaction.deskripsi"></td>
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
                            <td colspan="5" class="py-6 text-center text-platinum/70 italic">
                                Tidak ada transaksi ditemukan.
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>
    </div>
</x-app-layout>
