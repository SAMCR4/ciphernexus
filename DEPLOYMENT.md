
# Deployment & Release Guide

## Public key (embedded in loader)
Embed this public key in loader.js to verify signed bundles:
```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAno5xN/IKt2RAxUqmv75Q
jNMcSLgQEUe2F4mDP17namp4Qg62dAf5JvabzwwM3Y4yknb2wDM0sqnhOgmQafBP
locXXFySMlLynrruyEVp+VnkorYkWdpvi9UbOsCj25L0oftow5pcLk+TEQL/dsbm
bKFzy51SQ+0Ql27CQun3H7j1AIuTKESb4sTGo2jmOB7VCB1VWZTyka1k0TXWx7NB
GV32DNruWT8pG9teWAild7FNhLn47+1mwjB2jCdDNjaw8YnKjaVZxBSkuKVyLS1v
w5PWvqkPTOdMU3zguBL/QAkkxMLH4ilW4nmOxJu14Z0kgW/aplZoS0icfS+pbOBJ
/QIDAQAB
-----END PUBLIC KEY-----

```

## GitHub Actions
A release workflow is at `.github/workflows/release.yml` which will:
- run build
- sign bundle with PRIVATE_KEY_PEM secret
- update loader (tools/update-loader.js)
- create GitHub release and upload artifacts (bundle, signature, loader)

## How to set secrets
- PRIVATE_KEY_PEM: paste your private.pem content
- GITHUB_TOKEN: automatically available to actions

## Local signing (for testing)
You can sign locally:
```
openssl dgst -sha256 -sign private.pem -out dist/bundle.sha256.sig.bin dist/bundle.min.js
base64 dist/bundle.sha256.sig.bin > dist/bundle.sha256.sig
```
