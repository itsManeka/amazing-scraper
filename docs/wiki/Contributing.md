# Contributing

For the full contributing guide, see [CONTRIBUTING.md](https://github.com/itsmaneka/amazing-scraper/blob/main/CONTRIBUTING.md) in the repository.

## Quick Reference

### Setup

```bash
git clone https://github.com/itsmaneka/amazing-scraper.git
cd amazing-scraper
npm install
```

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Messages are validated automatically by commitlint.

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build process, tooling, or auxiliary changes |
| `ci` | CI/CD configuration changes |

### Testing

```bash
npm test              # run all tests
npm run test:coverage # with coverage report
```

Minimum coverage: **80%** (lines, functions, branches).

### CI/CD

- CI runs on every PR (lint, test, build, security audit)
- Releases are automated via semantic-release on merge to `main`
- Do **not** manually edit `version` in `package.json`
