<nav x-data="{ open: false }" class="bg-raisin sticky top-0" style="box-shadow: 0 4px 4px -2.5px rgba(0, 0, 0, 0.3);">
    <div class="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-20 items-center">

            {{-- Left (Toggle sidebar in mobile) --}}
            <div class="flex items-center">
                <button @click="open = !open"
                    class="md:hidden px-3 py-2 rounded-md text-platinum hover:bg-byzantine hover:text-night focus:outline-none focus:ring-2 focus:ring-inset focus:ring-byzantine">
                    <svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg">
                        <path x-show="!open" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 6h16M4 12h16M4 18h16" />
                        <path x-show="open" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <span class="text-2xl font-bold text-platinum hidden md:block select-none leading-none px-0" style="letter-spacing: -0.05em;">
                    {{ config('app.name', 'FinTrack') }}
                </span>
            </div>

            {{-- Right (User Info & Dropdown) --}}
            <div class="flex items-center space-x-4">
                <x-dropdown align="right" width="48">
                    <x-slot name="trigger">
                        <button
                            class="hidden md:flex items-center text-sm text-platinum select-none leading-none rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-byzantine">
                            Hello, {{ Auth::user()->name }}
                            <svg class="ml-1 h-4 w-4 text-byzantine" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    </x-slot>

                    <x-slot name="content">
                        <x-dropdown-link :href="route('profile.edit')">
                            {{ __('Profile') }}
                        </x-dropdown-link>

                        <form method="POST" action="{{ route('logout') }}">
                            @csrf
                            <x-dropdown-link :href="route('logout')"
                                onclick="event.preventDefault(); this.closest('form').submit();">
                                {{ __('Log Out') }}
                            </x-dropdown-link>
                        </form>
                    </x-slot>
                </x-dropdown>
            </div>
        </div>
    </div>
</nav>
