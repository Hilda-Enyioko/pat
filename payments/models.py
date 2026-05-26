from django.db import models
import uuid


class Transaction(models.Model):

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SUCCESS = 'success', 'Success'
        FAILED = 'failed', 'Failed'
        CANCELLED = 'cancelled', 'Cancelled'

    class Provider(models.TextChoices):
        PAYSTACK = 'paystack', 'Paystack'
        FLUTTERWAVE = 'flutterwave', 'Flutterwave'
        INTERSWITCH = 'interswitch', 'Interswitch'
        ZEST = 'zest', 'Zest'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pat_reference = models.CharField(max_length=100, unique=True)  # Pat-generated, human-readable
    provider_reference = models.CharField(max_length=100, blank=True, null=True)  # gateway's own ref
    email = models.EmailField()
    amount = models.PositiveIntegerField()  # in kobo. ₦50.00 = 5000
    currency = models.CharField(max_length=10, default='NGN')
    provider = models.CharField(max_length=20, choices=Provider.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    authorization_url = models.URLField(blank=True, null=True)  # redirect URL from gateway
    callback_url = models.URLField(blank=True, null=True)       # where Pat sends the user after payment
    metadata = models.JSONField(default=dict, blank=True)
    gateway_response = models.JSONField(default=dict, blank=True)  # raw gateway payload, for debugging
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.provider.upper()}] {self.pat_reference} | {self.email} | ₦{self.amount / 100:.2f} | {self.status}"

    @property
    def amount_in_naira(self):
        return self.amount / 100