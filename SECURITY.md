# Security Policy

## Supported Versions

This is a personal, self-hosted project. Only the latest commit on `main` is actively maintained.

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |
| Older commits | No |

## Responsible Disclosure

If you discover a security vulnerability in this project — especially one that could expose personal health data, credentials, or private logs — **please do not open a public GitHub Issue**.

Instead, report it privately:

1. Go to the repository's **Security** tab on GitHub
2. Click **"Report a vulnerability"** (GitHub's private advisory feature)
3. Describe the vulnerability, steps to reproduce, and potential impact

Alternatively, you can contact the maintainer directly via their GitHub profile.

I will acknowledge the report within 72 hours and aim to release a fix within 14 days for confirmed vulnerabilities.

## What to Include in a Report

- A clear description of the vulnerability
- The affected file(s) or endpoint(s)
- Steps to reproduce the issue
- Your assessment of the potential impact
- Any suggested remediation (optional but appreciated)

## Scope

The following are in scope for security reports:

- Authentication bypass or privilege escalation
- Firestore security rule weaknesses allowing cross-user data access
- API endpoints that leak user data without proper authorisation
- Secrets or credentials unintentionally exposed in source code or build artifacts
- Telegram webhook endpoints that can be spoofed or abused

The following are **out of scope**:

- Vulnerabilities in third-party dependencies (report directly to those projects)
- Issues that only affect a user's own self-hosted deployment
- Theoretical attacks with no practical exploitation path

## Thank You

Security researchers who responsibly disclose valid vulnerabilities will be credited in the repository's release notes (unless they prefer to remain anonymous).
