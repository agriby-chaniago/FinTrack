<x-guest-layout>
    <div class="mb-4 text-sm text-platinum/80">
        {{ __('This is a secure area of the application. Please confirm your password before continuing.') }}
    </div>

    <form method="POST" action="{{ route('password.confirm') }}" class="max-w-md w-full mx-auto space-y-6 text-platinum">
        @csrf

        <!-- Password -->
        <div>
            <x-input-label for="password" :value="__('Password')" class="text-sm font-medium text-platinum/80" />

            <x-text-input
                id="password"
                class="block mt-1 w-full bg-raisin2 border border-raisin2 rounded-md text-platinum placeholder:text-platinum/40 focus:ring-byzantine focus:border-byzantine transition"
                type="password"
                name="password"
                required
                autocomplete="current-password"
            />

            <x-input-error :messages="$errors->get('password')" class="mt-1 text-xs text-red-400" />
        </div>

        <div class="flex justify-end mt-4">
            <x-primary-button class="bg-raisin text-night hover:bg-byzantine px-6 py-2 rounded-md font-semibold shadow-sm transition">
                {{ __('Confirm') }}
            </x-primary-button>
        </div>
    </form>
</x-guest-layout>
