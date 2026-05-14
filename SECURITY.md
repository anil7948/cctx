# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.x | Yes |

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Email the details to the maintainer. You'll receive a response within 72 hours. If confirmed, a fix will be released within 7 days of disclosure.

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

## Scope

cctx runs entirely locally. It makes outbound connections to:
- `github.com/ollama/ollama/releases` — to download the Ollama binary on first setup
- `localhost:11435` (or configured port) — to communicate with the local Ollama daemon

It does not send any code, conversation content, or session data to external services.
