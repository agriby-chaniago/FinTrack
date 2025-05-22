<x-app-layout>
    <div class="bg-raisin2 rounded-2xl p-6 shadow-md">
        <div id="chart"></div>
    </div>

    <!-- ApexCharts CDN -->
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <script>
        const options = {
            chart: {
                type: 'bar',
                height: 400,
                foreColor: '#ffffff' // Semua teks jadi putih
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
            colors: ['#4A90E2', '#FF5E5E'], // Biru, merah
            xaxis: {
                categories: @json($months),
                labels: {
                    style: {
                        colors: '#ffffff'
                    }
                }
            },
            yaxis: {
                labels: {
                    style: {
                        colors: '#ffffff'
                    }
                }
            },
            title: {
                text: 'Grafik Pemasukan vs Pengeluaran per Hari',
                align: 'center',
                style: {
                    color: '#ffffff'
                }
            },
            plotOptions: {
                bar: {
                    horizontal: false,
                    columnWidth: '50%',
                }
            },
            legend: {
                labels: {
                    colors: '#ffffff'
                }
            },
            tooltip: {
                theme: 'dark'
            },
        };

        const chart = new ApexCharts(document.querySelector("#chart"), options);
        chart.render();
    </script>
</x-app-layout>
