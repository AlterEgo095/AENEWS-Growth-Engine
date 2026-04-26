# Security Policy

## 🔒 Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## 🐛 Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **security@aenews.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. We'll keep you updated on the progress.

## 🛡️ Security Measures

This project implements:

- JWT Authentication
- Rate Limiting
- Input Validation (Zod schemas)
- Helmet security headers
- HTTPS/TLS encryption
- Secret management
- Regular dependency updates
- Automated security scans (Trivy)

## 📋 Security Best Practices

When contributing:

1. Never commit secrets or credentials
2. Use environment variables
3. Keep dependencies updated
4. Follow OWASP guidelines
5. Run security scans locally

## 🔄 Updates

Security updates are released as soon as possible after a vulnerability is confirmed.
