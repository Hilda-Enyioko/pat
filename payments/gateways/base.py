from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

@dataclass
class GatewayResponse:
    """
    Consistent response format returned by every gateway adapter.
    Pat always returns this shape — never raw gateway responses.
    """

    success: bool
    provider: str
    pat_reference: str
    provider_reference: Optional[str]
    authorization_url: Optional[str]
    amount: int
    currency: str
    error_code: Optional[str]
    error_message: Optional[str]
    suggested_action: Optional[str]
    raw: dict

class BaseGateway(ABC):
    """
    Base class for all Pat gateway adapters.
    Each gateway adapter must implement the `process_payment` method.
    """

    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    def initiate(self, transaction) -> GatewayResponse:
        """
        Initialize a transaction with the gateway.
        Returns a GatewayResponse with authorization_url for redirect.
        """
        raise NotImplementedError
    
    @abstractmethod
    def verify(self, provider_reference: str) -> GatewayResponse:
        """
        Verify a transaction with the gateway using the provider reference.
        Called after the user completes (or abandons) payment.
        """
        raise NotImplementedError
    
    @abstractmethod
    def parse_webhook(self, payload: dict, headers: dict) -> GatewayResponse:
        """
        Parse and validate an incoming webhook from the gateway.
        Returns a normalized GatewayResponse.
        """
        raise NotImplementedError
    
    def build_error_response(
            self,
            provider: str,
            pat_reference: str,
            error_code: str,
            error_message: str,
            suggested_action: str,
            raw: dict
    ) -> GatewayResponse:
        """
        Convenience method for building consistent error responses.
        All adapters use this instead of constructing errors manually.
        """
        return GatewayResponse(
            success=False,
            provider=provider,
            pat_reference=pat_reference,
            provider_reference=None,
            authorization_url=None,
            amount=0,
            currency='NGN',
            error_code=error_code,
            error_message=error_message,
            suggested_action=suggested_action,
            raw=raw,
        )