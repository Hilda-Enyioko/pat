from django.db import models
import uuid

class Transaction(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    class Provider(models.TextChoices):
        PAYPAL = 'paypal', 'PayPal'
        SQUARE = 'flutterwave', 'Flutterwave'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=10, default='NGN')
    provider = models.CharField(max_length=20, choices=Provider.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    provider_reference = models.CharField(max_length=100, blank=True, null=True)
    pat_reference = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.provider} | {self.email} | {self.amount} | {self.status}"