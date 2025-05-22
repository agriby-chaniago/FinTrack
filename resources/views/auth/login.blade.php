<x-guest-layout>
    <!-- Session Status -->
    <x-auth-session-status class="mb-4 text-byzantine" :status="session('status')" />

    <form method="POST" action="{{ route('login') }}" class="max-w-md w-full mx-auto space-y-6 text-platinum">
        @csrf

        <!-- Email Address -->
        <div>
            <x-input-label for="email" :value="__('Email')" class="text-sm font-medium text-platinum/80" />
            <x-text-input
                id="email"
                class="block mt-1 w-full bg-raisin border border-raisin2 rounded-md text-platinum placeholder:text-platinum/40 focus:ring-byzantine focus:border-byzantine transition"
                type="email"
                name="email"
                :value="old('email')"
                required
                autofocus
                autocomplete="username" />
            <x-input-error :messages="$errors->get('email')" class="mt-1 text-xs text-red-400" />
        </div>

        <!-- Password -->
        <div>
            <x-input-label for="password" :value="__('Password')" class="text-sm font-medium text-platinum/80" />
            <x-text-input
                id="password"
                class="block mt-1 w-full bg-raisin border border-raisin2 rounded-md text-platinum placeholder:text-platinum/40 focus:ring-byzantine focus:border-byzantine transition"
                type="password"
                name="password"
                required
                autocomplete="current-password" />
            <x-input-error :messages="$errors->get('password')" class="mt-1 text-xs text-red-400" />
        </div>

        <!-- Remember Me -->
        <div class="flex items-center">
            <input
                id="remember_me"
                type="checkbox"
                class="rounded border-raisin2 text-byzantine shadow-sm focus:ring-byzantine"
                name="remember" />
            <label for="remember_me" class="ml-2 text-sm text-platinum/80 select-none">
                {{ __('Remember me') }}
            </label>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between">
            @if (Route::has('password.request'))
            <a
                href="{{ route('password.request') }}"
                class="text-sm hover:text-platinum/60 text-byzantine transition rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-byzantine">
                {{ __('Forgot your password?') }}
            </a>
            @endif

            <x-primary-button class="bg-raisin text-night hover:bg-byzantine px-6 py-2 rounded-md font-semibold shadow-sm transition">
                {{ __('Log in') }}
            </x-primary-button>
        </div>
    </form>
</x-guest-layout>
