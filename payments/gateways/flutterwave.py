import hmac
import hashlib
import requests
from .base import BaseGateway, GatewayResponse

class FlutterwaveAdapter(BaseGateway):
    
    def initiate(self, transaction) -> GatewayResponse:
        url = f"{self.config['base_url']}/payments"
        headers ={
            "Authorization": f"Bearer {self.config['secret_key']}",
            "Content-Type": "application/json"
        }
        payload = {
            "tx_ref": transaction.pat_reference,
            "amount": transaction.amount / 100,  # Flutterwave accepts Naira, not Kobo
            "currency": transaction.currency,
            "redirect_url": transaction.callback_url,
            "customer": {
                "email": transaction.customer_email
            },
            "meta": {
                "pat_reference": transaction.pat_reference,
                **transaction.metadata,
            },
            "customizations": {
                "title": "Pat Payment",
            },
        }
        
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            data = response.json()
            
        except requests.exceptions.Timeout:
            return self._build_error_response(
                provider="flutterwave",
                pat_reference=transaction.pat_reference,
                error_code="GATEWAY_TIMEOUT",
                error_message="Flutterwave did not respond in time.",
                suggested_action="retry_or_switch_provider",
                raw={}
            )
        
        except requests.exceptions.RequestException as e:
            return self._build_error_response(
                provider="flutterwave",
                pat_reference=transaction.pat_reference,
                error_code="NETWORK_ERROR",
                error_message=str(e),
                suggested_action="retry_or_switch_provider",
                raw={}
            )

        if data.get("status") != "success":
            return self._build_error_response(
                provider="flutterwave",
                pat_reference=transaction.pat_reference,
                error_code="INITIATION_FAILED",
                error_message=data.get("message", "Unknown error from Flutterwave."),
                suggested_action="check_credentials_or_payload",
                raw=data
            )
        
        return GatewayResponse(
            success=True,
            provider="flutterwave",
            pat_reference=transaction.pat_reference,
            provider_reference=data["data"]["id"],
            authorization_url=data["data"]["link"],
            amount=transaction.amount,
            currency=transaction.currency,
            error_code=None,
            error_message=None,
            suggested_action=None,
            raw=data
        )
        
    def verify(self, provider_reference: str) -> GatewayResponse:
        url = f"{self.config['base_url']}/transactions/{provider_reference}/verify"
        headers = {
            "Authorization": f"Bearer {self.config['secret_key']}",
        }
        try:
            response = requests.get(url, headers=headers, timeout=30)
            data = response.json()
            
        except requests.exceptions.Timeout:
            return self._build_error_response(
                provider="flutterwave",
                pat_reference='',
                error_code="GATEWAY_TIMEOUT",
                error_message="Flutterwave verification timed out.",
                suggested_action="retry_verification",
                raw={}
            )
        except requests.exceptions.RequestException as e:
            return self._build_error_response(
                provider="flutterwave",
                pat_reference='',
                error_code="NETWORK_ERROR",
                error_message=str(e),
                suggested_action="retry_verification",
                raw={}
            )
        
        if data.get("status") != "success":
            return self._build_error_response(
                provider="flutterwave",
                pat_reference='',
                error_code="VERIFICATION_FAILED",
                error_message=data.get("message", "Unknown error from Flutterwave."),
                suggested_action="contact_support",
                raw=data
            )
        
        tx_data = data["data"]
        success = tx_data["status"] == "successful"  # Flutterwave uses "successful" to indicate a completed payment
        
        return GatewayResponse(
            success=success,
            provider="flutterwave",
            pat_reference=tx_data.get('meta', {}).get('pat_reference', ''),
            provider_reference=str(tx_data["id"]),
            authorization_url=None,
            amount=int(tx_data["amount"] * 100),  # Convert back to Kobo
            currency=tx_data["currency"],
            error_code=None if success else "PAYMENT_UNSUCCESFUL",
            error_message=None if success else tx_data.get("processor_response"),
            suggested_action=None if success else "prompt_user_to_retry",
            raw=data
        )
    
    def parse_webhook(self, payload: dict, headers: dict) -> GatewayResponse:
        # Flutterwave uses a scret hash, not HMAC signature.
        secret_hash = self.config.get("secret_hash", self.config["secret_key"])
        incoming_hash = headers.get("verif-hash", "")
        
        if incoming_hash != secret_hash:
            return self._build_error_response(
                provider="flutterwave",
                pat_reference='',
                error_code="INVALID_SIGNATURE",
                error_message="Webhook hash verification failed.",
                suggested_action="discard event",
                raw=payload,
            )
        
        event = payload.get("event")
        data = payload.get("data", {})
        success = event == "charge.completed" and data.get("status") == "successful"
        
        return GatewayResponse(
            success=success,
            provider="flutterwave",
            pat_reference=data.get('meta', {}).get('pat_reference', ''),
            provider_reference=str(data.get("id", "")),
            authorization_url=None,
            amount=int(data.get("amount", 0) * 100),  # Convert to Kobo
            currency=data.get("currency", ""),
            error_code=None if success else 'WEBHOOK_NON_SUCCESS_EVENT',
            error_message=None if success else f"Event received: {event}",
            suggested_action=None if success else 'log_and_ignore',
            raw=payload,
        )
        