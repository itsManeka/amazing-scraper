# Contributing to amazing-scraper

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10

## Setup

```bash
git clone https://github.com/itsmaneka/amazing-scraper.git
cd amazing-scraper
npm install
```

After `npm install`, [Husky](https://typicode.github.io/husky/) automatically sets up Git hooks for commit linting and staged file linting.

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes following the [code style](#code-style) guidelines
4. Write or update tests to cover your changes
5. Validate locally:
   ```bash
   npm run lint
   npm test
   npm run build
   ```
6. Commit using [Conventional Commits](#commit-convention)
7. Push: `git push origin feature/my-feature`
8. Open a Pull Request against `main`

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). All commit messages are validated by [commitlint](https://commitlint.js.org/) via a Git hook.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Code style changes (formatting, semicolons, etc.) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build process, tooling, or auxiliary changes |
| `ci` | CI/CD configuration changes |
| `revert` | Reverts a previous commit |

### Examples

```bash
git commit -m "feat: add support for Kindle format detection"
git commit -m "fix: handle empty coupon metadata gracefully"
git commit -m "docs: update API reference examples"
git commit -m "chore: upgrade TypeScript to 5.9"
git commit -m "test: add edge case for expired coupon"
```

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit footer or use `!` after the type:

```bash
git commit -m "feat!: rename extractCouponProducts to extractCoupon"
```

This triggers a **major** version bump via semantic-release.

## Code Style

- **Language:** TypeScript (strict mode)
- **Architecture:** Clean Architecture (domain / application / infrastructure)
- **Naming:** PascalCase for classes and interfaces, camelCase for functions and variables
- **Types:** Explicit types on function parameters, avoid `any`
- **Documentation:** JSDoc on all public functions

## Testing

```bash
npm test              # run all tests
npm run test:coverage # with coverage report
npm run test:watch    # watch mode
```

### Requirements

- Minimum **80%** coverage (lines, functions, branches)
- All tests must pass before submitting a PR
- Cover both **success** and **error** cases
- Use **mocks** for external dependencies (HTTP, file system)
- Test **edge cases** (empty results, invalid input, timeouts)

## CI/CD

- **CI** runs automatically on every PR: lint, tests (Node 20 + 22), build, security audit
- **Releases** are fully automated via [semantic-release](https://semantic-release.gitbook.io/) on merge to `main`
- Do **not** manually edit `version` in `package.json` — it is managed by semantic-release

## Architecture

```
src/
  domain/          Entities and errors (no external dependencies)
  application/     Use cases and port interfaces
  infrastructure/  Adapters: HTTP client, HTML parser, logger
  index.ts         Public API and factory
```

## Questions?

Open an [issue](https://github.com/itsmaneka/amazing-scraper/issues) or start a [discussion](https://github.com/itsmaneka/amazing-scraper/discussions).
