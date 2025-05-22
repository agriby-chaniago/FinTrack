<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">

<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="csrf-token" content="{{ csrf_token() }}" />

    <title>{{ config('app.name', 'Laravel') }}</title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.bunny.net" />
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

    <!-- Scripts -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>

<body class="font-sans antialiased bg-night text-platinum">
    <div class="flex min-h-screen">

        <!-- Sidebar -->
        <aside class="w-20 bg-raisin shadow-none border-none hidden md:flex flex-col items-center py-8 px-4 space-y-8 sticky top-0 h-screen" style="box-shadow: 4px 0 10px -4px rgba(0, 0, 0, 0.5);">
            <!-- Logo Dompet -->
            <div class="flex flex-col items-center space-y-2 mb-2">
                <svg class="w-11 h-11 text-byzantine" fill="currentColor" viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h9a2 2 0 002-2v-1h-3.5a1.5 1.5 0 010-3H15V6a2 2 0 00-2-2H4z" />
                    <path d="M15 11h3v2h-3v-2z" />
                </svg>
            </div>

            <!-- Navigation -->
            <nav class="flex flex-col items-center space-y-6 text-platinum">

                <!-- Dashboard -->
                <a href="{{ route('dashboard') }}"
                    class="flex flex-col items-center text-center hover:text-byzantine {{ request()->routeIs('dashboard') ? 'text-byzantine font-semibold' : '' }}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="w-7 h-7" viewBox="0 0 24 24">
                        <path d="M2.25 12L12 3l9.75 9v8.25a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V15a.75.75 0 00-.75-.75H10.5A.75.75 0 009.75 15v5.25a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V12z" />
                    </svg>
                    <span class="text-xs mt-1 mb-2">Dashboard</span>
                </a>

                <!-- Add -->
                <a href="{{ route('transactions.create') }}"
                    class="flex flex-col items-center text-center hover:text-byzantine {{ request()->routeIs('transactions.create') ? 'text-byzantine font-semibold' : '' }}">
                    <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 20 20"
                        xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd"
                            d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                            clip-rule="evenodd" />
                    </svg>
                    <span class="text-xs mt-1 mb-2">Add</span>
                </a>

                <!-- History -->
                <a href="{{ route('transactions.index') }}"
                    class="flex flex-col items-center text-center hover:text-byzantine {{ request()->routeIs('transactions.index') ? 'text-byzantine font-semibold' : '' }}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="w-7 h-7" viewBox="0 0 24 24">
                        <path fill-rule="evenodd"
                            d="M2.625 6.75a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Zm4.875 0A.75.75 0 0 1 8.25 6h12a.75.75 0 0 1 0 1.5h-12a.75.75 0 0 1-.75-.75ZM2.625 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0ZM7.5 12a.75.75 0 0 1 .75-.75h12a.75.75 0 0 1 0 1.5h-12A.75.75 0 0 1 7.5 12Zm-4.875 5.25a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Zm4.875 0a.75.75 0 0 1 .75-.75h12a.75.75 0 0 1 0 1.5h-12a.75.75 0 0 1-.75-.75Z"
                            clip-rule="evenodd" />
                    </svg>
                    <span class="text-xs mt-1 mb-2">History</span>
                </a>

                <a href="{{ route('stats.index') }}"
                    class="flex flex-col items-center text-center hover:text-byzantine {{ request()->routeIs('stats.index') ? 'text-byzantine font-semibold' : '' }}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="w-7 h-7" viewBox="0 0 24 24">
                        <path
                            d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.036-.84-1.875-1.875-1.875h-.75ZM9.75 8.625c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-.75a1.875 1.875 0 0 1-1.875-1.875V8.625ZM3 13.125c0-1.036.84-1.875 1.875-1.875h.75c1.036 0 1.875.84 1.875 1.875v6.75c0 1.035-.84 1.875-1.875 1.875h-.75A1.875 1.875 0 0 1 3 19.875v-6.75Z" />
                    </svg>
                    <span class="text-xs mt-1 mb-2">Stats</span>
                </a>
            </nav>
        </aside>

        <!-- Main Content -->
        <div class="flex-1 flex flex-col">

            <!-- Navbar -->
            @include('layouts.navigation')

            <!-- Page Header -->
            @isset($header)
            <header class="bg-raisin2 shadow">
                <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 text-platinum">
                    {{ $header }}
                </div>
            </header>
            @endisset

            <!-- Page Content -->
            <main class="flex-1 p-6 bg-night text-platinum">
                {{ $slot }}
            </main>
        </div>
    </div>

    <!-- ApexCharts CDN -->
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
</body>

</html>
