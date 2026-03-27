# Contributing to Voluntary Justice

Thank you for your interest in contributing to Voluntary Justice! This document provides guidelines for contributing to this blockchain-based justice system project.

## About the Project

Voluntary Justice is a decentralized justice system built on blockchain technology. It aims to provide transparent, fair, and accessible dispute resolution.

## How to Contribute

### Reporting Issues

- Use the GitHub issue tracker to report bugs or suggest features
- Check existing issues before creating new ones
- Provide detailed information including:
  - Steps to reproduce (for bugs)
  - Expected vs actual behavior
  - Screenshots or logs if applicable
  - Environment details (OS, Node version, etc.)

### Development Workflow

1. **Fork the Repository**
   ```bash
   git clone https://github.com/your-username/voluntaryjustice.git
   cd voluntaryjustice
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

5. **Make Changes**
   - Write clean, documented code
   - Follow existing code patterns
   - Add tests for new functionality

6. **Test Your Changes**
   ```bash
   # Compile contracts
   npm run compile
   
   # Run tests
   npm test
   
   # Check coverage
   npx hardhat coverage
   ```

7. **Commit and Push**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   git push origin feature/your-feature-name
   ```

8. **Submit a Pull Request**
   - Provide a clear description of changes
   - Link related issues
   - Ensure CI checks pass

## Smart Contract Guidelines

### Security

- Follow established security patterns
- Avoid common vulnerabilities (reentrancy, overflow, etc.)
- Use OpenZeppelin contracts where appropriate
- Consider gas optimization

### Code Style

- Use Solidity 0.8.x features
- Add NatSpec documentation to all public functions
- Use descriptive variable names
- Keep functions focused and modular

### Testing

- Write comprehensive test cases
- Test edge cases and failure scenarios
- Aim for high code coverage
- Use Hardhat's testing framework

## Frontend Guidelines

- Follow the existing React/JavaScript patterns
- Ensure responsive design
- Test in multiple browsers

## Documentation

- Update README.md for user-facing changes
- Update docs/ for architectural changes
- Add inline comments for complex logic

## Review Process

- All PRs require at least one review
- Address review comments promptly
- Maintainers have final approval authority

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Respect differing viewpoints

## Questions?

Open an issue or reach out to the maintainers.

Thank you for contributing to Voluntary Justice!
