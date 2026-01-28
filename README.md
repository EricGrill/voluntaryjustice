# VoluntaryJustice

**Decentralized Dispute Resolution Protocol for Voluntary, Contract-Based Justice**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![Tests](https://img.shields.io/badge/Tests-624%20passing-brightgreen)]()
[![Status](https://img.shields.io/badge/Status-Ready%20for%20Deployment-success)]()

---

## Overview

VoluntaryJustice is a maximally on-chain dispute resolution protocol that enables individuals and organizations to resolve disputes without state courts. The system uses economic incentives, insurance, reputation, and arbitration to create a self-sustaining justice marketplace.

**Status: Final Draft - Ready for Testnet Deployment**

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

### Phase 4: Governance
| Contract | Purpose |
|----------|---------|
| `VJGovernor.sol` | OpenZeppelin Governor with timelock |
| `GovernorTimelock.sol` | Timelock controller for governance actions |
| `ConstitutionalConstraints.sol` | Parameter bounds and invariant protection |
| `EmergencyMultisig.sol` | Emergency pause/unpause with multi-sig |
| `ParameterRegistry.sol` | Centralized protocol configuration |

### Phase 5: Oracle & Legacy Integration
| Contract | Purpose |
|----------|---------|
| `PriceOracle.sol` | Chainlink price feeds with fallback |
| `VRFConsumer.sol` | Chainlink VRF for random jury selection |
| `LegacyCourtBridge.sol` | Off-chain ruling imports with verification |

### Phase 6: Production Readiness
| Contract | Purpose |
|----------|---------|
| `ProxyAdmin.sol` | Upgrade administration |
| `UpgradeableProxy.sol` | UUPS proxy pattern |
| `CircuitBreaker.sol` | Automated emergency response |
| `RateLimiter.sol` | Transaction rate limiting |
| `AuditLog.sol` | Immutable action logging |
| `ProtocolFees.sol` | Fee collection and distribution |

---

## Frontend

A complete Next.js frontend application is included in the `frontend/` directory.

### Tech Stack
- **Framework:** Next.js 14 (App Router)
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
# 624 tests passing
```

### Deploy to Local Network

```bash
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
```

### Deploy to Testnet

```bash
# Set environment variables
export SEPOLIA_RPC_URL=<your-rpc-url>
export PRIVATE_KEY=<deployer-private-key>

npx hardhat run scripts/deploy.js --network sepolia
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
| Governance | OpenZeppelin Governor + Timelock |
| Upgrades | UUPS Proxy Pattern |

---

## Roadmap

- [x] **Phase 1** - Core MVP (Identity, Contracts, Disputes, Escrow)
- [x] **Phase 2** - Insurance & Appeals (Jury, Insurance, Enforcement)
- [x] **Phase 3** - Bounty Market & Exclusion (ExclusionRegistry, BountyMarket)
- [x] **Phase 4** - Governance (Governor, Timelock, Constraints, Emergency)
- [x] **Phase 5** - Oracle & Legacy Integration (Chainlink, VRF, Legacy Bridge)
- [x] **Phase 6** - Production Readiness (Upgrades, Circuit Breaker, Audit Log)
- [x] **Phase 7** - Frontend Application (Next.js, RainbowKit, shadcn/ui)
- [ ] **Phase 8** - Security Audit
- [ ] **Phase 9** - Testnet Deployment
- [ ] **Phase 10** - Mainnet Launch

---

## Security

### Audit Status
- [ ] External security audit pending

### Security Features
- Role-based access control (OpenZeppelin AccessControl)
- Reentrancy guards on all state-changing functions
- Circuit breaker for emergency pause
- Rate limiting on sensitive operations
- Timelock on governance actions
- Multi-sig emergency controls

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
