<x-app-layout>
    <div class="p-6 space-y-10 bg-raisin2 rounded-2xl shadow-md">

        <!-- Grafik Batang -->
        <div>
            <div id="bar-chart"></div>
        </div>

        <!-- Grafik Garis (Saldo) -->
        <div>
            <div id="line-chart"></div>
        </div>

        <!-- Grafik Donut (Komposisi Kategori) -->
        <div>
            <div id="donut-chart"></div>
        </div>
    </div>

    <!-- ApexCharts CDN -->
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <script>
        const barOptions = {
            chart: {
                type: 'bar',
                height: 350,
                foreColor: '#ffffff'
            },
            series: [
                {
                    name: 'Pemasukan',
                    data: @json($income)
                },
                {
                    name: 'Pengeluaran',
                    data: @json($expense)
                }
            ],
            colors: ['#4A90E2', '#FF5E5E'],
            xaxis: {
                categories: @json($days),
                labels: { style: { colors: '#ffffff' } }
            },
            yaxis: {
                labels: { style: { colors: '#ffffff' } }
            },
            title: {
                text: 'Pemasukan vs Pengeluaran (7 Hari Terakhir)',
                align: 'center',
                style: { color: '#ffffff' }
            },
            legend: {
                labels: { colors: '#ffffff' }
            },
            tooltip: { theme: 'dark' }
        };

        const lineOptions = {
            chart: {
                type: 'line',
                height: 350,
                foreColor: '#ffffff'
            },
            series: [{
                name: 'Saldo',
                data: @json($saldo)
            }],
            colors: ['#00E396'],
            xaxis: {
                categories: @json($days),
                labels: { style: { colors: '#ffffff' } }
            },
            yaxis: {
                labels: { style: { colors: '#ffffff' } }
            },
            title: {
                text: 'Saldo Harian',
                align: 'center',
                style: { color: '#ffffff' }
            },
            tooltip: { theme: 'dark' }
        };

        const donutOptions = {
            chart: {
                type: 'donut',
                height: 350,
                foreColor: '#ffffff'
            },
            series: @json($kategoriValues),
            labels: @json($kategoriLabels),
            colors: ['#FDCB6E', '#E17055', '#00B894', '#0984E3', '#6C5CE7'],
            title: {
                text: 'Komposisi Jenis Transaksi',
                align: 'center',
                style: { color: '#ffffff' }
            },
            legend: {
                labels: { colors: '#ffffff' }
            },
            tooltip: { theme: 'dark' }
        };

        new ApexCharts(document.querySelector("#bar-chart"), barOptions).render();
        new ApexCharts(document.querySelector("#line-chart"), lineOptions).render();
        new ApexCharts(document.querySelector("#donut-chart"), donutOptions).render();
    </script>
</x-app-layout>
