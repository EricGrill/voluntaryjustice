# Contributing to VoluntaryJustice

Thank you for your interest in contributing to the VoluntaryJustice protocol. This document outlines the process for contributing to this decentralized dispute resolution system.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/EricGrill/voluntaryjustice.git
cd voluntaryjustice

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration

# Compile contracts
npm run compile

# Run tests
npm test
```

## Workflow

1. **Fork the repository** and create your branch from `master`.
2. **Install dependencies** with `npm install`.
3. **Make your changes** following the guidelines below.
4. **Add or update tests** for any contract changes.
5. **Ensure all tests pass** with `npm test`.
6. **Run the linter** if configured.
7. **Submit a pull request** with a clear description of the changes.

## Smart Contract Guidelines

- Follow the [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html).
- Use OpenZeppelin contracts where available.
- All new contracts must include comprehensive NatSpec documentation.
- All state-changing functions must have corresponding tests.
- Keep contracts focused on a single responsibility.
- Minimize external calls within loops.
- Use `immutable` and `constant` where possible.
- Follow checks-effects-interactions pattern to prevent reentrancy.

## Testing Requirements

- All contracts must have unit tests with >80% line coverage.
- Integration tests are required for cross-contract interactions.
- Fuzz tests are encouraged for math-heavy contracts.
- Test files should follow the naming convention: `ContractName.test.js`.

## Security

This protocol handles real economic value. Security is paramount:

- Report vulnerabilities privately via [SECURITY.md](./SECURITY.md).
- Never commit private keys or API credentials.
- All changes affecting fund flow require additional review.
- Consider edge cases around reentrancy, integer overflow, and access control.

## Commit Messages

Use conventional commits:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation changes
- `chore:` tooling, dependencies, config
- `test:` adding or updating tests
- `refactor:` code change that neither fixes a bug nor adds a feature
- `security:` security fix or improvement

## Pull Request Process

1. Update the README.md if your changes affect usage or architecture.
2. Ensure the test suite passes.
3. Request review from a maintainer.
4. Address review feedback promptly.
5. Squash commits if requested.

## Code of Conduct

Be respectful, constructive, and professional. Disagreement is welcome; hostility is not.
