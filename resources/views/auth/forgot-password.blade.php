<x-guest-layout>
    <div class="mb-4 text-sm text-platinum/80">
        {{ __('Forgot your password? No problem. Just let us know your email address and we will email you a password reset link that will allow you to choose a new one.') }}
    </div>

    <!-- Session Status -->
    <x-auth-session-status class="mb-4 text-byzantine" :status="session('status')" />

    <form method="POST" action="{{ route('password.email') }}" class="w-full space-y-6 text-platinum">
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
            />
            <x-input-error :messages="$errors->get('email')" class="mt-1 text-xs text-red-400" />
        </div>

        <div class="flex items-center justify-end mt-4">
            <x-primary-button class="bg-raisin text-night hover:bg-byzantine px-6 py-2 rounded-md font-semibold shadow-sm transition">
                {{ __('Email Password Reset Link') }}
            </x-primary-button>
        </div>
    </form>
</x-guest-layout>
