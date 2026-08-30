import os
import threading

from azure.identity import DefaultAzureCredential, ManagedIdentityCredential


credential_lock = threading.Lock()
credential: ManagedIdentityCredential | DefaultAzureCredential | None = None


def get_azure_credential() -> ManagedIdentityCredential | DefaultAzureCredential:
    global credential
    if credential is not None:
        return credential
    with credential_lock:
        if credential is None:
            if os.environ.get("WEBSITE_INSTANCE_ID") or os.environ.get("IDENTITY_ENDPOINT"):
                credential = ManagedIdentityCredential()
            else:
                credential = DefaultAzureCredential(
                    exclude_interactive_browser_credential=True,
                )
    return credential


def reset_azure_credential() -> None:
    global credential
    credential = None
