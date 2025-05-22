<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" class="h-full bg-night text-platinum">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>{{ config('app.name', 'FinTrack') }}</title>

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

    <!-- Scripts -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])

    <style>
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }

            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
</head>

<body class="font-sans antialiased bg-gradient-to-br from-night via-raisin to-raisin2">
    <div class="min-h-screen flex flex-col items-center justify-center px-6 py-12 animate-[fadeIn_1s_ease-out]">
        <!-- Logo -->
        <div class="mb-12">
            <a href="{{ url('/dashboard') }}"
                class="text-byzantine text-2xl font-light tracking-widest uppercase block text-center select-none hover:text-byzantine/70 transition-colors duration-300">
                FinTrack
            </a>
        </div>

        <!-- Card -->
        <div class="w-full max-w-xl bg-raisin2/90 backdrop-blur-sm shadow-lg rounded-2xl px-10 py-8 space-y-6">
            {{ $slot }}
        </div>
    </div>
</body>

</html>
