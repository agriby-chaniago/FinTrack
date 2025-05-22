<header class="text-left">
    <h2 class="text-xl font-semibold tracking-wide text-platinum">
        {{ __('Delete Account') }}
    </h2>

    <p class="mt-2 text-sm text-platinum/70 leading-relaxed">
        {{ __('Once your account is deleted, all of its resources and data will be permanently deleted. Before deleting your account, please download any data or information that you wish to retain.') }}
    </p>
</header>

<x-danger-button
    x-data=""
    x-on:click.prevent="$dispatch('open-modal', 'confirm-user-deletion')"
    class="mt-4 w-full bg-byzantine hover:bg-byzantine-hover text-platinum font-semibold py-2 rounded transition-colors duration-300 text-left"
>
    {{ __('Delete Account') }}
</x-danger-button>

<x-modal name="confirm-user-deletion" :show="$errors->userDeletion->isNotEmpty()" focusable>
    <form method="post" action="{{ route('profile.destroy') }}" class="p-6 bg-raisin text-platinum text-left">
        @csrf
        @method('delete')

        <h2 class="text-lg font-semibold mb-3">
            {{ __('Are you sure you want to delete your account?') }}
        </h2>

        <p class="text-sm text-platinum/70 mb-6 leading-snug">
            {{ __('Once your account is deleted, all of its resources and data will be permanently deleted. Please enter your password to confirm you would like to permanently delete your account.') }}
        </p>

        <div>
            <x-input-label for="password" value="{{ __('Password') }}" class="sr-only" />

            <x-text-input
                id="password"
                name="password"
                type="password"
                class="w-full bg-raisin border border-gray-600 text-platinum placeholder-platinum/60 rounded py-2 px-3 focus:ring-2 focus:ring-byzantine focus:outline-none transition"
                placeholder="{{ __('Password') }}"
                autocomplete="current-password"
            />

            <x-input-error :messages="$errors->userDeletion->get('password')" class="mt-2 text-red-500" />
        </div>

        <div class="mt-6 flex justify-end gap-4">
            <x-secondary-button
                x-on:click="$dispatch('close')"
                class="bg-raisin hover:bg-gray-700 text-platinum font-semibold py-2 px-4 rounded transition-colors duration-300"
            >
                {{ __('Cancel') }}
            </x-secondary-button>

            <x-danger-button class="bg-red-600 hover:bg-red-700 text-platinum font-semibold py-2 px-4 rounded transition-colors duration-300">
                {{ __('Delete Account') }}
            </x-danger-button>
        </div>
    </form>
</x-modal>
