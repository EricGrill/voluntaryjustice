# VoluntaryJustice

**Decentralized Dispute Resolution Protocol for Voluntary, Contract-Based Justice**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.25-363636?logo=solidity)](https://soliditylang.org/)
[![Tests](https://img.shields.io/badge/Tests-742%20passing-brightgreen)]()
[![CI](https://github.com/EricGrill/voluntaryjustice/actions/workflows/ci.yml/badge.svg)](https://github.com/EricGrill/voluntaryjustice/actions)
[![Status](https://img.shields.io/badge/Status-Unaudited%20Draft-orange)]()

---

## Overview

VoluntaryJustice is a maximally on-chain dispute resolution protocol that enables individuals and organizations to resolve disputes without state courts. The system uses economic incentives, insurance, reputation, and arbitration to create a self-sustaining justice marketplace.

**Status: Working Draft — Unaudited. Not yet deployed. See [Project Status](#project-status) before using.**

```
┌─────────────────────────────────────────────────────────────────┐
│                        Protocol Layer                            │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐│
│  │ Identity  │ │ Contract  │ │Arbitration│ │    Governance     ││
│  │ Registry  │ │  Engine   │ │  Courts   │ │  (Governor+Token) ││
│  └───────────┘ └───────────┘ └───────────┘ └───────────────────┘│
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐│
│  │ Insurance │ │Enforcement│ │Reputation │ │  Oracle/Legacy    ││
│  │   Pools   │ │  Engine   │ │  Scoring  │ │   Integration     ││
│  └───────────┘ └───────────┘ └───────────┘ └───────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Status

This is a **working draft built for research and demonstration**. It is **not production-ready** and **has not been deployed** to any network.

| Area | State |
|------|-------|
| Smart contracts | 22 contracts implemented; compile clean on Solidity 0.8.25 |
| Tests | 742 passing, 0 pending; overall **74.2% branch** / 95.4% statement coverage |
| Core coverage | `DisputeResolution` (88%), `VJGovernor` (92%), and the insurance contracts (85–93%) are now at 80%+ branch coverage |
| Remaining coverage gaps | `BountyMarket`, `EnforcementEngine`, `CrossChainBridge`, and a few others remain below 80% branch |
| Security | Internal review only — **no external audit, no static analysis, no bug bounty** |
| Frontend | Next.js app wired to contract hooks, but contract addresses are unset and the root landing page is still scaffolding |
| Deployment | Scripts exist; nothing deployed; addresses not wired into the frontend |

**Do not use with real funds.** See the [Internal Security Review](docs/security/SECURITY_AUDIT.md) for known gaps.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Tiered Arbitration** | Single arbitrator → Jury appeal |
| **Multi-Dimensional Reputation** | Compliance, dispute rate, payment history, ratings |
| **Insurance System** | Protocol baseline + open market |
| **Economic Enforcement** | Escrow, insurance, staking, reputation, exclusion |
| **Template Contracts** | DAO-approved contract templates |
| **On-Chain Governance** | OpenZeppelin Governor with constitutional constraints |
| **Oracle Integration** | Chainlink price feeds and VRF for jury selection |
| **Legacy Court Bridge** | Off-chain court ruling imports with verification |

---

## Smart Contracts

### Phase 1: Core MVP
| Contract | Purpose |
|----------|---------|
| `VJToken.sol` | ERC-20 governance token with staking hooks |
| `IdentityRegistry.sol` | Identity registration with sybil protection |
| `ReputationScoring.sol` | Multi-dimensional on-chain reputation |
| `ContractTemplateRegistry.sol` | DAO-managed contract templates |
| `ContractFactory.sol` | Contract creation and signing |
| `CourtRegistry.sol` | Arbitration court registration and staking |
| `DisputeResolution.sol` | Dispute lifecycle with appeals |
| `EscrowVault.sol` | Secure escrow management |
| `StakingRewards.sol` | Multi-role staking with rewards |

### Phase 2: Insurance & Appeals
| Contract | Purpose |
|----------|---------|
| `JurorPool.sol` | Juror staking and VRF-ready jury selection |
| `BaselineInsurancePool.sol` | Community insurance coverage |
| `InsurerRegistry.sol` | Private insurer registration |
| `InsurancePolicy.sol` | Policy purchase, renewal, claims |
| `EnforcementEngine.sol` | Ruling execution and escalation |

### Phase 3: Bounty Market & Exclusion
| Contract | Purpose |
|----------|---------|
| `ExclusionRegistry.sol` | Permanent exclusion records for non-compliance |
| `BountyMarket.sol` | Recovery bounties with oracle/court/debtor verification |

### Phase 4: Governance & Anchoring
| Contract | Purpose |
|----------|---------|
| `VJGovernor.sol` | OpenZeppelin Governor with built-in timelock (`GovernorTimelockControl`) and constitutional constraints (forbidden-selector checks that block defining crimes, overriding contracts, granting immunity, or compelling participation) |
| `RulingAnchor.sol` | Anchors final dispute rulings for cross-layer reference |

### Phase 5: Oracle & Legacy Integration
| Contract | Purpose |
|----------|---------|
| `OracleRegistry.sol` | Trusted oracle network for recovery attestations (staking, quorum, slashing) |
| `LegacyCourtBridge.sol` | Off-chain court ruling imports with multi-jurisdiction support and a challenge period |

### Phase 6: Cross-Chain & Randomness
| Contract | Purpose |
|----------|---------|
| `VRFConsumer.sol` | Chainlink VRF v2.5 consumer for random jury selection |
| `CrossChainBridge.sol` | L2 ↔ mainnet messaging for ruling anchoring (Arbitrum, Optimism, Base) |

> A `MockVRFCoordinator.sol` mock lives under `contracts/mocks/` for testing VRF flows.

**Total: 22 production contracts.**

---

## Frontend

A complete Next.js frontend application is included in the `frontend/` directory.

### Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Wallet:** RainbowKit + wagmi v2
- **Styling:** shadcn/ui + Tailwind CSS
- **State:** TanStack Query
- **Forms:** React Hook Form + zod

### Pages
- **Dashboard** - Overview stats, quick actions
- **Contracts** - Create, view, sign contracts
- **Disputes** - File disputes, submit evidence, view rulings
- **Insurance** - Browse insurers, purchase policies
- **Courts** - Browse courts, register as arbitrator
- **Governance** - View proposals, cast votes

### Run Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## How It Works

### Dispute Lifecycle

```
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│  Filed   │───►│  Evidence │───►│  Ruling  │───►│ Enforce │
└──────────┘    └───────────┘    └──────────┘    └─────────┘
                                       │
                                       ▼ (if appealed)
                               ┌──────────────┐
                               │  Jury Panel  │
                               └──────────────┘
```

### Enforcement Hierarchy

1. **Escrow Transfer** - Smart contract releases to victor
2. **Insurance Claim** - Protocol triggers claim against debtor's insurer
3. **Bond Slashing** - Slash debtor's staked tokens
4. **Reputation Downgrade** - Compliance score impacts future access
5. **Exclusion Registry** - Barred from system participation

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/EricGrill/voluntaryjustice.git
cd voluntaryjustice
npm install
```

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npm test
# 742 tests passing
```

### Deploy to Local Network

```bash
npx hardhat node
npx hardhat run scripts/deploy-full.js --network localhost
```

### Deploy to Testnet

```bash
# Set environment variables
export SEPOLIA_RPC_URL=<your-rpc-url>
export PRIVATE_KEY=<deployer-private-key>

npx hardhat run scripts/deploy-testnet.js --network sepolia
```

> Deploy scripts write the resulting addresses to `deployments/<network>-latest.json`. The frontend's `frontend/lib/contracts/addresses.ts` is not yet auto-populated — addresses must currently be copied in manually.

---

## Token: VJ

**Utilities:**
- Court staking (required to operate as arbitrator)
- Juror staking (required to join jury pool)
- Insurer staking (required to offer coverage)
- Governance voting
- Registry access fees

**Staking Roles:**
- **Court** - 50% of rewards
- **Juror** - 30% of rewards
- **Insurer** - 20% of rewards

---

## Insurance Tiers

| Tier | Coverage | Contract Limits |
|------|----------|-----------------|
| **Uninsured** | None | Max 0.1 ETH, 100% escrow |
| **Baseline** | Protocol pool | Max 1 ETH, 50% escrow |
| **Standard** | Baseline + supplemental | Max 10 ETH, 25% escrow |
| **Premium** | High-limit | Unlimited, flexible escrow |

---

## Architecture

Full architecture design: [`docs/plans/2026-01-28-aegis-architecture-design.md`](docs/plans/2026-01-28-aegis-architecture-design.md)

### Design Decisions

| Decision | Choice |
|----------|--------|
| Blockchain | Ethereum/EVM |
| On-chain approach | Maximally on-chain |
| Scaling | L2 operations + mainnet anchoring |
| Identity | Hybrid (native + existing primitives) |
| Arbitration | Tiered (single + jury appeal) |
| Enforcement | Court-directed escalation |
| Insurance | Protocol baseline + open market |
| Governance | OpenZeppelin Governor + built-in Timelock |
| Upgrades | Non-upgradeable (contracts are immutable once deployed; no proxy layer yet) |

---

## Roadmap

- [x] **Phase 1** - Core MVP (Identity, Contracts, Disputes, Escrow)
- [x] **Phase 2** - Insurance & Appeals (Jury, Insurance, Enforcement)
- [x] **Phase 3** - Bounty Market & Exclusion (ExclusionRegistry, BountyMarket)
- [x] **Phase 4** - Governance & Anchoring (Governor with timelock + constitutional constraints, RulingAnchor)
- [x] **Phase 5** - Oracle & Legacy Integration (OracleRegistry, LegacyCourtBridge)
- [x] **Phase 6** - Cross-Chain & Randomness (VRFConsumer, CrossChainBridge)
- [x] **Phase 7** - Frontend Application (Next.js, RainbowKit, shadcn/ui)
- [x] **Phase 8** - Internal review & coverage reports
- [x] **Phase 9** - Core/governance/insurance contracts raised to 80%+ branch coverage
- [ ] **Phase 10** - Raise remaining contracts (BountyMarket, EnforcementEngine, …) to 80%+ branch
- [ ] **Phase 11** - External security audit + bug bounty
- [ ] **Phase 12** - Testnet deployment & full user-flow testing
- [ ] **Phase 13** - Mainnet preparation

---

## Security

### Audit Status
- [x] Internal review only (not an external audit)
- [x] Test coverage: 95.4% statements, 74.2% branches, 96.2% lines (full table in the audit report)
- [x] Branch coverage on core/insurance/governance contracts raised to 80%+
- [ ] Branch coverage on remaining contracts (BountyMarket, EnforcementEngine, CrossChainBridge, …) below 80%
- [ ] External security audit — **not started**
- [ ] Static analysis (Slither/Mythril) — not yet run
- [ ] Bug bounty — not launched

### Security Documentation
- [Internal Security Review](docs/security/SECURITY_AUDIT.md)
- [Deployment Checklist](docs/security/DEPLOYMENT_CHECKLIST.md)

### Security Features (implemented in code)
- Role-based access control (OpenZeppelin AccessControl)
- Reentrancy guards on state-changing functions
- Timelock on governance actions (OpenZeppelin `GovernorTimelockControl`)
- Constitutional constraints in the Governor (forbidden-selector checks)
- Staking + slashing for courts, jurors, insurers, and oracles

> Not yet implemented (despite being on the roadmap): an *enforced* global pause / circuit breaker (the Governor has a `paused` flag, but no other contract reads it), rate limiting, a dedicated emergency-multisig contract, and an upgrade/proxy layer.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, smart contract guidelines, and the PR process.

For security issues, see [SECURITY.md](SECURITY.md).

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Connect

Built by [Eric Grill](https://ericgrill.com)

[![Website](https://img.shields.io/badge/ericgrill.com-000?style=flat&logo=safari&logoColor=white)](https://ericgrill.com)
[![X](https://img.shields.io/badge/@EricGrill-000?style=flat&logo=x&logoColor=white)](https://x.com/EricGrill)
