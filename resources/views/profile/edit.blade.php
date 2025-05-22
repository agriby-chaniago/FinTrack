<x-app-layout>
    <div class="py-12 min-h-screen bg-raisin">
        <div class="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
            <div class="p-6 sm:p-8 bg-raisin2 shadow-md rounded-lg border border-raisin3 text-platinum">

                @include('profile.partials.update-profile-information-form')

            </div>

            <div class="p-6 sm:p-8 bg-raisin2 shadow-md rounded-lg border border-raisin3 text-platinum">

                @include('profile.partials.update-password-form')

            </div>

            <div class="p-6 sm:p-8 bg-raisin2 shadow-md rounded-lg border border-raisin3 text-platinum">

                @include('profile.partials.delete-user-form')

            </div>
        </div>
    </div>
</x-app-layout>
