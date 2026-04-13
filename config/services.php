<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'groq' => [
        'base_url' => env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
        'api_key' => env('GROQ_API_KEY'),
        'model' => env('GROQ_MODEL', 'llama-3.1-8b-instant'),
    ],

    'analyzer' => [
        'url' => env('ANALYZER_SERVICE_URL', 'http://localhost:8002/api/analyze'),
        'api_key' => env('ANALYZER_SERVICE_API_KEY', env('INTER_SERVICE_API_KEY')),
    ],

    'planner' => [
        'url' => env('PLANNER_SERVICE_URL', 'http://localhost:8003/api/plan'),
        'api_key' => env('PLANNER_SERVICE_API_KEY', env('INTER_SERVICE_API_KEY')),
    ],

    'service2_pull' => [
        'api_key' => env('SERVICE2_PULL_API_KEY', env('INTER_SERVICE_API_KEY')),
        'max_items' => (int) env('SERVICE2_PULL_MAX_ITEMS', 1000),
    ],

    'service3_callback' => [
        'api_key' => env('SERVICE3_CALLBACK_API_KEY', env('INTER_SERVICE_API_KEY')),
    ],

    'inter_service' => [
        'api_key' => env('INTER_SERVICE_API_KEY'),
        'allow_legacy_fallback' => env('INTER_SERVICE_ALLOW_LEGACY_FALLBACK', true),
    ],

];
