#!/usr/bin/env python3
import argparse
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from artifacts.key_vault import KeyVaultDekManager
from artifacts.manifest import build_encrypted_artifact
from credits.domain import canonical_json
from credits.signing import configured_registry_signer


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Encrypt an artifact and create its signed public manifest.",
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--ciphertext-output", required=True)
    parser.add_argument("--manifest-output", required=True)
    parser.add_argument("--ciphertext-url", required=True)
    parser.add_argument("--logical-name", required=True)
    parser.add_argument(
        "--content-type",
        default="application/octet-stream",
    )
    args = parser.parse_args()

    vault_url = os.environ.get("ARTIFACT_KEY_VAULT_URL", "").strip()
    key_name = os.environ.get("ARTIFACT_WRAPPING_KEY_NAME", "").strip()
    if not vault_url or not key_name:
        raise SystemExit(
            "ARTIFACT_KEY_VAULT_URL and ARTIFACT_WRAPPING_KEY_NAME are required.",
        )
    plaintext = Path(args.input).read_bytes()
    key_manager = KeyVaultDekManager(vault_url, key_name)
    ciphertext, manifest = build_encrypted_artifact(
        plaintext=plaintext,
        logical_name=args.logical_name,
        content_type=args.content_type,
        ciphertext_url=args.ciphertext_url,
        created_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        wrap_dek=key_manager.wrap,
        signer=configured_registry_signer(),
        random_bytes=os.urandom,
    )
    ciphertext_path = Path(args.ciphertext_output)
    manifest_path = Path(args.manifest_output)
    ciphertext_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_bytes = canonical_json(manifest) + b"\n"
    ciphertext_path.write_bytes(ciphertext)
    manifest_path.write_bytes(manifest_bytes)
    print(f"artifact_id={manifest['artifact_id']}")
    print(f"manifest_sha256={hashlib.sha256(manifest_bytes).hexdigest()}")
    print(f"ciphertext_output={ciphertext_path}")
    print(f"manifest_output={manifest_path}")


if __name__ == "__main__":
    main()
