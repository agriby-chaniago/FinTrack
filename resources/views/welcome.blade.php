<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" class="h-full bg-night text-platinum">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FinTrack</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    <style>
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body class="h-full font-sans antialiased bg-gradient-to-br from-night via-raisin to-raisin2">

    <div class="min-h-screen flex items-center px-8 sm:px-16 py-12">
        <div class="space-y-10 animate-[fadeIn_1s_ease-out] max-w-3xl">
            <h1 class="text-5xl sm:text-6xl font-extrabold text-byzantine">
                FinTrack
            </h1>
            <p class="text-xl sm:text-2xl text-platinum/80 leading-relaxed">
                Aplikasi manajemen keuangan minimalis. <br> Silakan login atau daftar untuk mulai menggunakan.
            </p>

            <div class="flex flex-col sm:flex-row gap-4">
                @auth
                    <a href="{{ url('/dashboard') }}"
                       class="px-6 py-3 text-lg bg-byzantine text-night rounded-lg font-semibold hover:bg-byzantine/90 transition">
                        Dashboard
                    </a>
                @else
                    <a href="{{ route('login') }}"
                       class="px-6 py-3 text-lg bg-byzantine text-night rounded-lg font-semibold hover:bg-byzantine/90 transition">
                        Login
                    </a>
                    @if (Route::has('register'))
                        <a href="{{ route('register') }}"
                           class="px-6 py-3 text-lg border border-byzantine text-byzantine rounded-lg font-semibold hover:bg-raisin transition">
                            Register
                        </a>
                    @endif
                @endauth
            </div>
        </div>
    </div>

</body>
</html>
