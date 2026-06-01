from .base import BaseGateway, GatewayResponse


class InterswitchAdapter(BaseGateway):
    """
    Interswitch gateway adapter.
    Stub — full implementation post-MVP.
    Interswitch docs: https://sandbox.interswitchng.com/docbase/docs
    """

    def initiate(self, transaction) -> GatewayResponse:
        return self._build_error_response(
            provider='interswitch',
            pat_reference=transaction.pat_reference,
            error_code='PROVIDER_NOT_IMPLEMENTED',
            error_message='Interswitch integration is not yet available.',
            suggested_action='use_paystack_or_flutterwave',
            raw={},
        )

    def verify(self, provider_reference: str) -> GatewayResponse:
        return self._build_error_response(
            provider='interswitch',
            pat_reference='',
            error_code='PROVIDER_NOT_IMPLEMENTED',
            error_message='Interswitch integration is not yet available.',
            suggested_action='use_paystack_or_flutterwave',
            raw={},
        )

    def parse_webhook(self, payload: dict, headers: dict) -> GatewayResponse:
        return self._build_error_response(
            provider='interswitch',
            pat_reference='',
            error_code='PROVIDER_NOT_IMPLEMENTED',
            error_message='Interswitch integration is not yet available.',
            suggested_action='use_paystack_or_flutterwave',
            raw=payload,
        )