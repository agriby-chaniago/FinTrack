<?php

namespace App\Http\Requests\Api;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class Service3PlanResultCallbackRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'user_id' => ['required', 'integer', 'exists:users,id'],
            'correlation_id' => ['nullable', 'string', 'max:255', 'required_without:analysis_id'],
            'analysis_id' => ['nullable', 'string', 'max:255', 'required_without:correlation_id'],
            'status' => ['required', 'in:success,failed'],
            'summary_text' => ['nullable', 'string'],
            'recommendations' => ['nullable', 'array'],
            'goals' => ['nullable', 'array'],
            'raw_payload' => ['required', 'array'],
            'plan_period_start' => ['nullable', 'date'],
            'plan_period_end' => ['nullable', 'date', 'after_or_equal:plan_period_start'],
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

    public function correlationId(): string
    {
        return (string) ($this->input('correlation_id') ?: $this->input('analysis_id'));
    }

    public function payloadForStorage(): array
    {
        return [
            'user_id' => (int) $this->input('user_id'),
            'correlation_id' => $this->correlationId(),
            'analysis_id' => $this->input('analysis_id'),
            'status' => (string) $this->input('status'),
            'summary_text' => $this->input('summary_text'),
            'recommendations' => $this->has('recommendations') ? $this->input('recommendations') : null,
            'goals' => $this->has('goals') ? $this->input('goals') : null,
            'raw_payload' => $this->input('raw_payload'),
            'plan_period_start' => $this->input('plan_period_start'),
            'plan_period_end' => $this->input('plan_period_end'),
            'last_attempted_at' => now(),
        ];
    }
}
