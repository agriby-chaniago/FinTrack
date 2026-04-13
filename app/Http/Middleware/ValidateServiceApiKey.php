<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ValidateServiceApiKey
{
    public function handle(Request $request, Closure $next, string $context = 'default'): Response
    {
        $expectedApiKey = $this->resolveExpectedApiKey($context);

        if ($expectedApiKey === '') {
            return new JsonResponse([
                'success' => false,
                'message' => 'Service API key is not configured on the server.',
            ], 500);
        }

        $providedApiKey = (string) $request->header('x-api-key', '');

        if (! hash_equals($expectedApiKey, $providedApiKey)) {
            return new JsonResponse([
                'success' => false,
                'message' => 'Invalid service API key.',
            ], 401);
        }

        return $next($request);
    }

    private function resolveExpectedApiKey(string $context): string
    {
        $apiKey = match ($context) {
            'service2_pull' => (string) config('services.service2_pull.api_key'),
            'service3_callback' => (string) config('services.service3_callback.api_key'),
            default => (string) config('services.inter_service.api_key'),
        };

        if ($apiKey !== '') {
            return $apiKey;
        }

        $allowLegacyFallback = (bool) config('services.inter_service.allow_legacy_fallback', true);

        if ($context !== 'default' && $allowLegacyFallback) {
            return (string) config('services.inter_service.api_key');
        }

        return '';
    }
}
