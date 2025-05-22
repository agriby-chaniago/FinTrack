<x-app-layout>
    <div class="mx-auto py-12 px-6 text-platinum font-sans animate-fadeIn max-w-3xl">
        <h2 class="text-4xl font-semibold mb-10 text-byzantine tracking-wider">Edit Transaksi</h2>

        {{-- Notifikasi sukses --}}
        @if (session('success'))
        <div class="bg-green-800 bg-opacity-25 text-green-300 p-4 mb-8 rounded-lg text-sm leading-relaxed">
            {{ session('success') }}
        </div>
        @endif

        {{-- Error Validation --}}
        @if ($errors->any())
        <div class="bg-red-800 bg-opacity-25 text-red-300 p-4 mb-8 rounded-lg text-sm leading-relaxed">
            <ul class="list-disc list-inside space-y-1">
                @foreach ($errors->all() as $error)
                <li>{{ $error }}</li>
                @endforeach
            </ul>
        </div>
        @endif

        <form action="{{ route('transactions.update', $transaction->id) }}" method="POST" class="space-y-8">
            @csrf
            @method('PUT')

            <div>
                <label for="nominal" class="block mb-3 font-semibold text-platinum text-lg">Nominal (Rp)</label>
                <input
                    type="number"
                    id="nominal"
                    name="nominal"
                    step="100"
                    placeholder="Masukkan nominal"
                    value="{{ old('nominal', $transaction->nominal) }}"
                    required
                    class="w-full rounded-lg border border-gray-500 bg-transparent px-5 py-3 text-platinum placeholder-gray-500
                 focus:outline-none focus:ring-2 focus:ring-byzantine focus:border-byzantine transition">
            </div>

            <div>
                <label for="kategori" class="block mb-3 font-semibold text-platinum text-lg">Kategori</label>
                <select
                    id="kategori"
                    name="kategori"
                    required
                    class="w-full rounded-lg border border-gray-500 bg-transparent px-5 py-3 text-platinum
                 focus:outline-none focus:ring-2 focus:ring-byzantine focus:border-byzantine transition">
                    <option value="" disabled {{ old('kategori', $transaction->kategori) ? '' : 'selected' }} class="text-gray-500">Pilih Kategori</option>
                    <option value="pemasukan" {{ old('kategori', $transaction->kategori) == 'pemasukan' ? 'selected' : '' }}>Pemasukan</option>
                    <option value="pengeluaran" {{ old('kategori', $transaction->kategori) == 'pengeluaran' ? 'selected' : '' }}>Pengeluaran</option>
                </select>
            </div>

            <div>
                <label for="tanggal" class="block mb-3 font-semibold text-platinum text-lg">Tanggal</label>
                <input
                    type="date"
                    id="tanggal"
                    name="tanggal"
                    value="{{ old('tanggal', \Carbon\Carbon::parse($transaction->tanggal)->format('Y-m-d')) }}"
                    required
                    class="w-full rounded-lg border border-gray-500 bg-transparent px-5 py-3 text-platinum
                 focus:outline-none focus:ring-2 focus:ring-byzantine focus:border-byzantine transition">
            </div>

            <div>
                <label for="deskripsi" class="block mb-3 font-semibold text-platinum text-lg">Deskripsi</label>
                <input
                    type="text"
                    id="deskripsi"
                    name="deskripsi"
                    placeholder="Masukkan deskripsi"
                    value="{{ old('deskripsi', $transaction->deskripsi) }}"
                    class="w-full rounded-lg border border-gray-500 bg-transparent px-5 py-3 text-platinum placeholder-gray-500
                 focus:outline-none focus:ring-2 focus:ring-byzantine focus:border-byzantine transition">
            </div>

            <div class="flex justify-end">
                <button
                    type="submit"
                    class="rounded-lg bg-byzantine px-10 py-3 font-semibold text-platinum hover:bg-byzantine-hover transition duration-300">
                    Simpan
                </button>
            </div>
        </form>
    </div>
</x-app-layout>
