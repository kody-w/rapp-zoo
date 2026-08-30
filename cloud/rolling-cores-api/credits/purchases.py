import os
from typing import Protocol

from .domain import (
    PurchaseVerificationUnavailable,
    VerifiedPurchase,
    bounded_text,
)


class PurchaseVerifier(Protocol):
    def verify(self, provider: str, receipt: str, product_id: str) -> VerifiedPurchase:
        ...


class DisabledPurchaseVerifier:
    def __init__(self, mode: str = "disabled"):
        self.mode = mode

    def verify(self, provider: str, receipt: str, product_id: str) -> VerifiedPurchase:
        del provider, receipt, product_id
        raise PurchaseVerificationUnavailable(
            f"The {self.mode} purchase verification adapter is not configured.",
        )


class RevenueCatPurchaseVerifier(DisabledPurchaseVerifier):
    def __init__(self):
        super().__init__("revenuecat")


class AppStorePurchaseVerifier(DisabledPurchaseVerifier):
    def __init__(self):
        super().__init__("app-store")


class BitcoinWebhookVerifier(DisabledPurchaseVerifier):
    def __init__(self):
        super().__init__("bitcoin")


def configured_purchase_verifier() -> PurchaseVerifier:
    mode = bounded_text(
        os.environ.get("PURCHASE_VERIFIER_MODE", "disabled"),
        "PURCHASE_VERIFIER_MODE",
        64,
    ).lower()
    if mode not in {"disabled", "revenuecat", "app-store", "bitcoin"}:
        raise RuntimeError("PURCHASE_VERIFIER_MODE is not supported.")
    return {
        "disabled": DisabledPurchaseVerifier,
        "revenuecat": RevenueCatPurchaseVerifier,
        "app-store": AppStorePurchaseVerifier,
        "bitcoin": BitcoinWebhookVerifier,
    }[mode]()
