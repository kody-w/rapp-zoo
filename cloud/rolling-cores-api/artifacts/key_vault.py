from azure.keyvault.keys import KeyClient
from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm

from azure_auth import get_azure_credential
from credits.domain import CreditError


class KeyVaultDekManager:
    def __init__(self, vault_url: str, key_name: str):
        self.vault_url = vault_url.rstrip("/")
        self.key_name = key_name
        self.credential = get_azure_credential()
        self.key_client = KeyClient(
            vault_url=self.vault_url,
            credential=self.credential,
        )

    def wrap(self, dek: bytes) -> tuple[str, bytes]:
        key = self.key_client.get_key(self.key_name)
        result = CryptographyClient(key.id, self.credential).wrap_key(
            KeyWrapAlgorithm.rsa_oaep_256,
            dek,
        )
        return key.id, result.encrypted_key

    def unwrap(self, key_id: str, wrapped_dek: bytes) -> bytes:
        allowed_prefix = f"{self.vault_url}/keys/{self.key_name}/"
        if not key_id.startswith(allowed_prefix):
            raise CreditError("Manifest wrapping key is not an issuer key.")
        result = CryptographyClient(key_id, self.credential).unwrap_key(
            KeyWrapAlgorithm.rsa_oaep_256,
            wrapped_dek,
        )
        return result.key
