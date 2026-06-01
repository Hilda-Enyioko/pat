from .base import BaseGateway, GatewayResponse


class ZestAdapter(BaseGateway):
    """
    Zest Payment gateway adapter (Stanbic IBTC).
    Stub — full implementation post-MVP.
    Zest docs: https://apidocs.dev.gateway.zestpayment.com
    """

    def initiate(self, transaction) -> GatewayResponse:
        return self._build_error_response(
            provider='zest',
            pat_reference=transaction.pat_reference,
            error_code='PROVIDER_NOT_IMPLEMENTED',
            error_message='Zest integration is not yet available.',
            suggested_action='use_paystack_or_flutterwave',
            raw={},
        )

    def verify(self, provider_reference: str) -> GatewayResponse:
        return self._build_error_response(
            provider='zest',
            pat_reference='',
            error_code='PROVIDER_NOT_IMPLEMENTED',
            error_message='Zest integration is not yet available.',
            suggested_action='use_paystack_or_flutterwave',
            raw={},
        )

    def parse_webhook(self, payload: dict, headers: dict) -> GatewayResponse:
        return self._build_error_response(
            provider='zest',
            pat_reference='',
            error_code='PROVIDER_NOT_IMPLEMENTED',
            error_message='Zest integration is not yet available.',
            suggested_action='use_paystack_or_flutterwave',
            raw=payload,
        )