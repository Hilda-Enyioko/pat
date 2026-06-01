from django.conf import settings
from .paystack import PaystackAdapter
from .flutterwave import FlutterwaveAdapter
from .interswitch import InterswitchAdapter
from .zest import ZestAdapter
from .base import GatewayResponse

ADAPTER_MAP = {
    'paystack': PaystackAdapter,
    'flutterwave': FlutterwaveAdapter,
    'interswitch': InterswitchAdapter,
    'zest': ZestAdapter,
}

def get_adapter(provider: str):
    """
    Returns an instantiated gateway adapter for the given provider name.
    Pulls config from PAT_CONFIG in settings.
    """
    pat_config = settings.PAT_CONFIG
    gateway_config = pat_config['GATEWAYS'].get(provider)
    
    if not gateway_config:
        raise ValueError(f"Unknown gateway provider: '{provider}'. "
                         f"Valid options are: {list(ADAPTER_MAP.keys())}")
    
    adapter_class = ADAPTER_MAP.get(provider)
    if not adapter_class:
        raise ValueError(f"No adapter implemented for provider: '{provider}'.")
    
    return adapter_class(gateway_config)

def resolve_provider(requested_provider: str = None) -> str:
    """
    Determines which provider to use.
    - If developer explicitly requested one, use it.
    - Otherwise fall back to DEFAULT_GATEWAY from PAT_CONFIG.
    """
    
    if requested_provider:
        if requested_provider not in ADAPTER_MAP:
            raise ValueError(
                f"'{requested_provider}' is not a supported provider. "
                f"Valid options are: {list(ADAPTER_MAP.keys())}"
            )
        return requested_provider

    return settings.PAT_CONFIG['DEFAULT_GATEWAY']


def initiate_transaction(transaction, requested_provider: str = None) -> GatewayResponse:
    """
    Core routing function for transaction initiation.
    If provider is explicitly requested:
        - Use it. If it fails, return the error. No fallback.
    If no provider requested:
        - Use DEFAULT_GATEWAY.
        - If it fails, automatically retry with FALLBACK_GATEWAY.
        - If fallback also fails, return the fallback's error.
    """
    pat_config = settings.PAT_CONFIG

    if requested_provider:
        adapter = get_adapter(requested_provider)
        return adapter.initiate(transaction)

    # Auto-select: try default first
    default_provider = pat_config['DEFAULT_GATEWAY']
    fallback_provider = pat_config['FALLBACK_GATEWAY']

    default_adapter = get_adapter(default_provider)
    response = default_adapter.initiate(transaction)

    if response.success:
        return response

    # Default failed — try fallback silently
    fallback_adapter = get_adapter(fallback_provider)
    fallback_response = fallback_adapter.initiate(transaction)

    if fallback_response.success:
        return fallback_response

    # Both failed — return fallback error with context
    fallback_response.error_message = (
        f"Both {default_provider} and {fallback_provider} failed. "
        f"Last error: {fallback_response.error_message}"
    )
    fallback_response.error_code = 'ALL_GATEWAYS_FAILED'
    fallback_response.suggested_action = 'retry_later_or_contact_support'
    return fallback_response