<x-guest-layout>
    <form method="POST" action="{{ route('register') }}" class="max-w-xl w-full text-left text-platinum space-y-6 animate-[fadeIn_1s_ease-out]">
        @csrf

        <!-- Title -->
        <h2 class="text-3xl font-extrabold text-byzantine">Buat Akun Baru</h2>

        <!-- Name -->
        <div>
            <x-input-label for="name" :value="__('Nama')" class="text-sm font-medium text-platinum/80" />
            <x-text-input id="name" class="block mt-1 w-full bg-raisin border border-raisin2 text-platinum placeholder:text-platinum/30 focus:ring-byzantine focus:border-byzantine" type="text" name="name" :value="old('name')" required autofocus autocomplete="name" />
            <x-input-error :messages="$errors->get('name')" class="mt-2 text-sm text-red-400" />
        </div>

        <!-- Email Address -->
        <div>
            <x-input-label for="email" :value="__('Email')" class="text-sm font-medium text-platinum/80" />
            <x-text-input id="email" class="block mt-1 w-full bg-raisin border border-raisin2 text-platinum placeholder:text-platinum/30 focus:ring-byzantine focus:border-byzantine" type="email" name="email" :value="old('email')" required autocomplete="username" />
            <x-input-error :messages="$errors->get('email')" class="mt-2 text-sm text-red-400" />
        </div>

        <!-- Password -->
        <div>
            <x-input-label for="password" :value="__('Kata Sandi')" class="text-sm font-medium text-platinum/80" />
            <x-text-input id="password" class="block mt-1 w-full bg-raisin border border-raisin2 text-platinum placeholder:text-platinum/30 focus:ring-byzantine focus:border-byzantine"
                            type="password"
                            name="password"
                            required autocomplete="new-password" />
            <x-input-error :messages="$errors->get('password')" class="mt-2 text-sm text-red-400" />
        </div>

        <!-- Confirm Password -->
        <div>
            <x-input-label for="password_confirmation" :value="__('Konfirmasi Kata Sandi')" class="text-sm font-medium text-platinum/80" />
            <x-text-input id="password_confirmation" class="block mt-1 w-full bg-raisin border border-raisin2 text-platinum placeholder:text-platinum/30 focus:ring-byzantine focus:border-byzantine"
                            type="password"
                            name="password_confirmation" required autocomplete="new-password" />
            <x-input-error :messages="$errors->get('password_confirmation')" class="mt-2 text-sm text-red-400" />
        </div>

        <div class="flex items-center justify-between mt-6">
            <a class="text-sm text-platinum/60 hover:text-byzantine transition" href="{{ route('login') }}">
                {{ __('Sudah punya akun?') }}
            </a>

            <x-primary-button class="bg-byzantine text-night hover:bg-byzantine/90 px-6 py-2 rounded-lg font-semibold">
                {{ __('Daftar') }}
            </x-primary-button>
        </div>
    </form>
</x-guest-layout>
