# Contributing

Thanks for helping improve Codex Gateway Hub.

## Before You Start

- Read [README.md](README.md) for product context and local setup.
- Check open issues or recent commits before starting overlapping work.
- Prefer small, reviewable pull requests with a clear user-facing reason.

## Local Development

```bash
npm install
cp .env.example .env
npm run prisma:migrate
npm run dev
```

Useful endpoints during development:

- `http://127.0.0.1:3000/api/health`
- `http://127.0.0.1:3000/console/access`
- `http://127.0.0.1:3000/console/upstream`

## Pull Request Guidelines

- Explain the problem first, then the fix.
- Include screenshots for console UI changes.
- Update `README.md`, examples, or env docs when behavior changes.
- Keep secrets, real upstream keys, and private URLs out of commits.
- Add or update validation steps in the PR description when tests are not available.

## Documentation Contributions

High-impact docs contributions include:

- clearer onboarding
- provider compatibility notes
- deployment examples
- troubleshooting guides
- translated docs that stay aligned with the current feature set

## Issue Reports

When opening a bug, try to include:

- expected behavior
- actual behavior
- request route or console page
- redacted config details
- reproduction steps
- logs or screenshots when safe to share

## Code Style

- Follow the existing project structure and naming.
- Keep comments short and only where they reduce confusion.
- Prefer focused changes over broad refactors unless the refactor is the fix.
