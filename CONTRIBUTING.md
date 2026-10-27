# Contributing

Thanks for your interest in Tab Keeper.

## Before you start

Open an [issue](https://github.com/justine-george/tab-keeper-react-chrome-extension/issues) describing the bug or the change before writing code, so we can agree on the approach first. Pull requests without an issue may be closed.

Security issues go through [SECURITY.md](SECURITY.md), not issues.

## Setup

See [Development and Contributing](README.md#development-and-contributing) in the README for installing, building and loading the extension.

## Pull requests

- Keep each pull request to one change.
- Follow the existing code style. Prettier and ESLint settle formatting.
- Add or update tests for what you change.
- Before you open it, these must pass:

  ```sh
  npm run lint
  npm test
  npm run test:e2e
  ```

Every pull request is reviewed before merging, and not every one will be accepted.

By contributing, you agree that your work is released under the project's [MIT License](LICENSE).
