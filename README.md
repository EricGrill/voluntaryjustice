# VoluntaryJustice

**Decentralized Dispute Resolution Protocol for Voluntary, Contract-Based Justice**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![Tests](https://img.shields.io/badge/Tests-393%20passing-brightgreen)]()
[![Phase](https://img.shields.io/badge/Phase-2%20Complete-success)]()

---

## Overview

VoluntaryJustice is a maximally on-chain dispute resolution protocol that enables individuals and organizations to resolve disputes without state courts. The system uses economic incentives, insurance, reputation, and arbitration to create a self-sustaining justice marketplace.

```
┌─────────────────────────────────────────────────────┐
│                   Protocol Layer                     │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │
│  │ Identity  │ │ Contract  │ │    Arbitration    │  │
│  │ Registry  │ │  Engine   │ │      Courts       │  │
│  └───────────┘ └───────────┘ └───────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │
│  │ Insurance │ │Enforcement│ │    Reputation     │  │
│  │   Pools   │ │  Engine   │ │     Scoring       │  │
│  └───────────┘ └───────────┘ └───────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Tiered Arbitration** | Single arbitrator → Jury appeal |
| **Multi-Dimensional Reputation** | Compliance, dispute rate, payment history, ratings |
| **Insurance System** | Protocol baseline + open market |
| **Economic Enforcement** | Escrow, insurance, staking, reputation, exclusion |
| **Template Contracts** | DAO-approved contract templates |
| **On-Chain Governance** | Constitutional constraints prevent abuse |

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
```

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

---

## Roadmap

- [x] **Phase 1** - Core MVP (Identity, Contracts, Disputes, Escrow)
- [x] **Phase 2** - Insurance & Appeals (Jury, Insurance, Enforcement)
- [ ] **Phase 3** - Advanced Features (Bounty market, Oracles, Cross-chain)

---

## Contributing

Contributions welcome. Please read the architecture document before submitting PRs.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Connect

Built by [Eric Grill](https://ericgrill.com)

[![Website](https://img.shields.io/badge/ericgrill.com-000?style=flat&logo=safari&logoColor=white)](https://ericgrill.com)
[![X](https://img.shields.io/badge/@EricGrill-000?style=flat&logo=x&logoColor=white)](https://x.com/EricGrill)
