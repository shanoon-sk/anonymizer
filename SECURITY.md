# Security Policy

Anonymo processes sensitive documents, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via
[GitHub private vulnerability reporting](https://github.com/shanoon-sk/anonymo/security/advisories/new)
or by e-mail to **info@shanoon.sk**.

Include the app version, OS, and steps or a sample file (with fictional data) that reproduces the issue.
We aim to acknowledge reports within 5 working days.

## Scope

Especially relevant:

- Personal data that survives anonymization (e.g. text still present in a PDF after redaction, metadata, hidden sheets).
- Any network request made by the app. The app is designed to be fully offline.
- Data written to disk other than the user-chosen output files.
- Electron issues (IPC, sandbox escape, remote content loading).

## Supported versions

Only the latest release receives fixes.
