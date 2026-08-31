# Security policy

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Submit a private
report through [GitHub Security Advisories](https://github.com/duluca/document-ts/security/advisories/new)
with affected versions, reproduction steps, impact, and any proposed mitigation.
If private reporting is unavailable, contact the repository owner without
including exploit details in a public channel.

The maintainer will acknowledge a report within two business days, establish a
private remediation plan, and coordinate disclosure after a fix is available.
No response-time statement is a promise of a particular remediation date.

## Push-protection bypass ownership

`@duluca` owns push-protection bypass triage. Every bypass alert must receive an
initial triage within two business days. It must then either be resolved or have
an accountable assignee, a written rationale, and an expiry no later than 30
days after the alert was created. Expired exceptions are removed or renewed
only after a new review.

Bypasses are exceptional: a false positive should use the narrowest supported
exception, and a real credential must be revoked and removed from history as an
incident. Scanner output is sensitive and must be redacted before it is placed
in issues, pull requests, or build artifacts.

## Supported releases

Security fixes are made on the latest published major release. Older versions
may receive a fix only when the maintainer explicitly announces an exception.

## Release and repository controls

Package publication is allowed only from the approved `npm-release` GitHub
environment and a protected, signed version tag. Reusable npm publication
credentials are prohibited. The administrative setup, verification procedure,
and evidence checklist are maintained in
[`docs/security/repository-controls.md`](docs/security/repository-controls.md).
