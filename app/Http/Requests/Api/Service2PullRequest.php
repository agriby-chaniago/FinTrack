<?php

namespace App\Http\Requests\Api;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class Service2PullRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'since' => [
                'nullable',
                'string',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! is_string($value) || $value === '') {
                        return;
                    }

                    $isIso8601 = preg_match(
                        '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/',
                        $value
                    ) === 1;

                    if (! $isIso8601) {
                        $fail('The since parameter must be a valid ISO-8601 datetime.');

                        return;
                    }

                    try {
                        CarbonImmutable::parse($value);
                    } catch (\Throwable) {
                        $fail('The since parameter must be a valid ISO-8601 datetime.');
                    }
                },
            ],
            'include_summary' => ['nullable', 'boolean'],
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'success' => false,
            'message' => 'Invalid request parameters.',
            'errors' => $validator->errors(),
        ], 400));
    }

    public function since(): ?CarbonImmutable
    {
        $since = $this->input('since');

        if (! is_string($since) || $since === '') {
            return null;
        }

        return CarbonImmutable::parse($since);
    }

    public function includeSummary(): bool
    {
        return $this->boolean('include_summary', true);
    }
}
