import hmac
import hashlib
import requests
from .base import BaseGateway, GatewayResponse


class PaystackAdapter(BaseGateway):

    def initiate(self, transaction) -> GatewayResponse:
        url = f"{self.config['base_url']}/transaction/initialize"
        headers = {
            "Authorization": f"Bearer {self.config['secret_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "email": transaction.email,
            "amount": transaction.amount,  # already in kobo
            "reference": transaction.pat_reference,
            "callback_url": transaction.callback_url,
            "metadata": {
                "pat_reference": transaction.pat_reference,
                **transaction.metadata,
            },
        }

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            data = response.json()
        except requests.exceptions.Timeout:
            return self._build_error_response(
                provider='paystack',
                pat_reference=transaction.pat_reference,
                error_code='GATEWAY_TIMEOUT',
                error_message='Paystack did not respond in time.',
                suggested_action='retry_or_switch_provider',
                raw={},
            )
        except requests.exceptions.RequestException as e:
            return self._build_error_response(
                provider='paystack',
                pat_reference=transaction.pat_reference,
                error_code='NETWORK_ERROR',
                error_message=str(e),
                suggested_action='retry_or_switch_provider',
                raw={},
            )

        if not data.get('status'):
            return self._build_error_response(
                provider='paystack',
                pat_reference=transaction.pat_reference,
                error_code='INITIATION_FAILED',
                error_message=data.get('message', 'Unknown error from Paystack.'),
                suggested_action='check_credentials_or_payload',
                raw=data,
            )

        return GatewayResponse(
            success=True,
            provider='paystack',
            pat_reference=transaction.pat_reference,
            provider_reference=data['data']['reference'],
            authorization_url=data['data']['authorization_url'],
            amount=transaction.amount,
            currency=transaction.currency,
            error_code=None,
            error_message=None,
            suggested_action=None,
            raw=data,
        )

    def verify(self, provider_reference: str) -> GatewayResponse:
        url = f"{self.config['base_url']}/transaction/verify/{provider_reference}"
        headers = {
            "Authorization": f"Bearer {self.config['secret_key']}",
        }

        try:
            response = requests.get(url, headers=headers, timeout=30)
            data = response.json()
        except requests.exceptions.Timeout:
            return self._build_error_response(
                provider='paystack',
                pat_reference='',
                error_code='GATEWAY_TIMEOUT',
                error_message='Paystack verification timed out.',
                suggested_action='retry_verification',
                raw={},
            )
        except requests.exceptions.RequestException as e:
            return self._build_error_response(
                provider='paystack',
                pat_reference='',
                error_code='NETWORK_ERROR',
                error_message=str(e),
                suggested_action='retry_verification',
                raw={},
            )

        if not data.get('status'):
            return self._build_error_response(
                provider='paystack',
                pat_reference='',
                error_code='VERIFICATION_FAILED',
                error_message=data.get('message', 'Unknown error from Paystack.'),
                suggested_action='contact_support',
                raw=data,
            )

        tx_data = data['data']
        success = tx_data['status'] == 'success'

        return GatewayResponse(
            success=success,
            provider='paystack',
            pat_reference=tx_data.get('metadata', {}).get('pat_reference', ''),
            provider_reference=tx_data['reference'],
            authorization_url=None,
            amount=tx_data['amount'],
            currency=tx_data['currency'],
            error_code=None if success else 'PAYMENT_UNSUCCESSFUL',
            error_message=None if success else tx_data.get('gateway_response'),
            suggested_action=None if success else 'prompt_user_to_retry',
            raw=data,
        )

    def parse_webhook(self, payload: dict, headers: dict) -> GatewayResponse:
        # Verify the webhook signature first
        signature = headers.get('x-paystack-signature', '')
        computed = hmac.new(
            self.config['secret_key'].encode('utf-8'),
            msg=str(payload).encode('utf-8'),
            digestmod=hashlib.sha512,
        ).hexdigest()

        if not hmac.compare_digest(computed, signature):
            return self._build_error_response(
                provider='paystack',
                pat_reference='',
                error_code='INVALID_SIGNATURE',
                error_message='Webhook signature verification failed.',
                suggested_action='discard_event',
                raw=payload,
            )

        event = payload.get('event', '')
        data = payload.get('data', {})
        success = event == 'charge.success'

        return GatewayResponse(
            success=success,
            provider='paystack',
            pat_reference=data.get('metadata', {}).get('pat_reference', ''),
            provider_reference=data.get('reference'),
            authorization_url=None,
            amount=data.get('amount', 0),
            currency=data.get('currency', 'NGN'),
            error_code=None if success else 'WEBHOOK_NON_SUCCESS_EVENT',
            error_message=None if success else f"Event received: {event}",
            suggested_action=None if success else 'log_and_ignore',
            raw=payload,
        )