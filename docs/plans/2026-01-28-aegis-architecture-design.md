# Aegis Architecture Design

## Project: Polycentric Justice DAO

**Date:** 2026-01-28
**Status:** Approved
**Version:** 1.0

---

## Executive Summary

Aegis is a maximally on-chain dispute resolution protocol for voluntary, contract-based justice. The system enables individuals and organizations to resolve disputes without state courts using economic incentives, insurance, reputation, and arbitration.

### Key Design Decisions

| Decision | Choice |
|----------|--------|
| Blockchain | Ethereum/EVM |
| On-chain approach | Maximally on-chain (all logic in contracts) |
| Scaling | L2 operations + mainnet anchoring |
| L2 target | L2-agnostic design |
| Identity | Hybrid (native reputation + existing primitives) |
| Arbitration | Tiered (single arbitrator + jury appeal) |
| Enforcement | Court-directed escalation |
| Insurance | Protocol baseline + open market |
| Contracts | Template-based |
| DAO constraints | On-chain enforcement |
| Token model | Staking yield |

---

## 1. System Architecture

### Layer Overview

```
┌─────────────────────────────────────────────────────┐
│                    Frontend Layer                    │
│         (Dashboard, Dispute UI, Marketplace)         │
├─────────────────────────────────────────────────────┤
│                   Protocol Layer (L2)                │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │
│  │ Identity  │ │ Contract  │ │    Arbitration    │  │
│  │ Registry  │ │  Engine   │ │      Courts       │  │
│  └───────────┘ └───────────┘ └───────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────┐  │
│  │ Insurance │ │Enforcement│ │    Reputation     │  │
│  │   Pools   │ │  Engine   │ │     Scoring       │  │
│  └───────────┘ └───────────┘ └───────────────────┘  │
├─────────────────────────────────────────────────────┤
│              Anchoring Layer (Mainnet)               │
│    Final rulings, large escrows, exclusion registry  │
├─────────────────────────────────────────────────────┤
│                  Storage Layer (IPFS)                │
│       Contracts, evidence, ruling documents          │
└─────────────────────────────────────────────────────┘
```

### Core Principle

All dispute logic, enforcement triggers, and state transitions live in smart contracts. Off-chain components handle only storage (IPFS) and user interfaces. This maximizes censorship resistance at the cost of gas efficiency.

---

## 2. Identity & Reputation Layer

### Identity Strategy

**External integrations (not built, just connected):**
- **ENS** - Human-readable names mapped to addresses
- **Ethereum Attestation Service (EAS)** - Verifiable credentials
- **Sybil resistance** - Gitcoin Passport, Worldcoin, or similar

**Native components (built by Aegis):**

```
┌─────────────────────────────────────────────────────┐
│              AegisIdentityRegistry.sol              │
├─────────────────────────────────────────────────────┤
│ - registerIdentity(address, sybilProof)             │
│ - linkExternalIdentity(ens, eas, etc.)              │
│ - getIdentity(address) → IdentityProfile           │
└─────────────────────────────────────────────────────┘
```

### Multi-Dimensional Reputation

Four separate on-chain scores, updated after each dispute resolution:

| Score | Measures | Range |
|-------|----------|-------|
| **Compliance** | % of rulings fully complied with | 0-100 |
| **Dispute Rate** | Disputes filed against you per contract | 0-100 (inverse) |
| **Payment History** | Timeliness of restitution payments | 0-100 |
| **Counterparty Rating** | Peer ratings from completed contracts | 0-100 |

```
┌─────────────────────────────────────────────────────┐
│              ReputationScoring.sol                  │
├─────────────────────────────────────────────────────┤
│ - updateCompliance(address, ruling, complied)       │
│ - recordDispute(address, contractId)                │
│ - recordPayment(address, amount, daysToSettle)      │
│ - submitRating(from, to, score)                     │
│ - getScores(address) → (uint8, uint8, uint8, uint8) │
└─────────────────────────────────────────────────────┘
```

Insurers query these scores to price premiums. Counterparties see them before entering contracts.

---

## 3. Contract Engine

### Template-Based Architecture

Contracts are created from protocol-approved templates. Each template defines:
- Required parameters (parties, amounts, dates)
- Applicable rule set
- Default arbitration provider (overridable)
- Damages calculation formula
- Enforcement escalation path

```
┌─────────────────────────────────────────────────────┐
│              ContractTemplateRegistry.sol           │
├─────────────────────────────────────────────────────┤
│ - registerTemplate(templateHash, metadata)          │
│ - getTemplate(templateId) → TemplateInfo            │
│ - listTemplates(category) → TemplateInfo[]          │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              ContractFactory.sol                    │
├─────────────────────────────────────────────────────┤
│ - createContract(templateId, params, parties[])     │
│ - signContract(contractId, signature)               │
│ - getContract(contractId) → ContractState           │
│ - getContractsByParty(address) → contractId[]       │
└─────────────────────────────────────────────────────┘
```

### Contract Lifecycle

```
Draft → Pending Signatures → Active → [Disputed] → Completed/Terminated
```

### Storage Model

- **On-chain:** Contract hash, parties, status, escrow amounts, arbitrator address
- **IPFS:** Full contract text, parameters, human-readable terms
- **Anchoring:** Completed contracts with rulings anchored to mainnet

### Initial Template Categories

| Category | Example Use Cases |
|----------|-------------------|
| **Service** | Freelance work, consulting |
| **Sale** | Goods, digital assets |
| **Loan** | Peer-to-peer lending |
| **Employment** | Ongoing work relationships |
| **Escrow** | Third-party holding |

---

## 4. Arbitration System

### Tiered Structure

**Tier 1: Single Arbitrator (Default)**
- Fast, cheap, suitable for most disputes
- Parties agree on arbitrator in contract
- Arbitrator stakes tokens to participate

**Tier 2: Jury Panel (Appeal)**
- Losing party can appeal within 7 days
- 5-person jury randomly drawn from staked pool
- Higher fees, longer timeline
- Jury decision is final

### Court Registry

```
┌─────────────────────────────────────────────────────┐
│              CourtRegistry.sol                      │
├─────────────────────────────────────────────────────┤
│ - registerCourt(metadata, stake, rulesetHash)       │
│ - getCourt(courtId) → CourtInfo                     │
│ - listCourts(filters) → CourtInfo[]                 │
│ - slashCourt(courtId, amount, reason)               │
│ - withdrawStake(courtId) [with timelock]            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              JurorPool.sol                          │
├─────────────────────────────────────────────────────┤
│ - stakeAsJuror(amount)                              │
│ - unstake(amount) [with timelock]                   │
│ - drawJury(disputeId, seed) → address[5]            │
│ - slashJuror(address, amount, reason)               │
└─────────────────────────────────────────────────────┘
```

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

```
┌─────────────────────────────────────────────────────┐
│              DisputeResolution.sol                  │
├─────────────────────────────────────────────────────┤
│ - fileDispute(contractId, claim, evidenceHash)      │
│ - submitEvidence(disputeId, evidenceHash)           │
│ - submitRuling(disputeId, ruling, enforcement)      │
│ - appeal(disputeId, stake)                          │
│ - submitJuryVote(disputeId, vote, commitment)       │
│ - finalizeRuling(disputeId)                         │
└─────────────────────────────────────────────────────┘
```

### Ruling Structure

Each ruling specifies:
- Liability determination (who owes what)
- Restitution amount
- Enforcement path (ordered list of mechanisms to try)
- Deadline for voluntary compliance

---

## 5. Enforcement Engine

### Enforcement Hierarchy

Court-directed escalation - the ruling specifies which mechanisms to use and in what order:

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENFORCEMENT HIERARCHY                        │
├─────────────────────────────────────────────────────────────────┤
│  Level 1: ESCROW TRANSFER (automatic)                           │
│  └─► Funds already locked, smart contract releases to victor    │
│                                                                 │
│  Level 2: INSURANCE CLAIM (automatic)                           │
│  └─► Protocol triggers claim against debtor's insurer           │
│                                                                 │
│  Level 3: BOND SLASHING (automatic)                             │
│  └─► Slash debtor's staked tokens, transfer to creditor         │
│                                                                 │
│  Level 4: REPUTATION DOWNGRADE (automatic)                      │
│  └─► Compliance score tanks, future insurance/contracts harder  │
│                                                                 │
│  Level 5: EXCLUSION REGISTRY (DAO-managed)                      │
│  └─► Added to on-chain exclusion list, barred from system       │
│                                                                 │
│  Level 6: BOUNTY (market-based)                                 │
│  └─► Recovery bounty posted, verified by oracle/court/debtor    │
└─────────────────────────────────────────────────────────────────┘
```

### Smart Contracts

```
┌─────────────────────────────────────────────────────┐
│              EnforcementEngine.sol                  │
├─────────────────────────────────────────────────────┤
│ - executeEnforcement(rulingId, level)               │
│ - escalate(rulingId) [moves to next level]          │
│ - checkCompliance(rulingId) → bool                  │
│ - markVoluntaryCompliance(rulingId, proof)          │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              ExclusionRegistry.sol (Mainnet)        │
├─────────────────────────────────────────────────────┤
│ - addToRegistry(address, rulingHash, reason)        │
│ - removeFromRegistry(address) [DAO vote required]   │
│ - isExcluded(address) → bool                        │
│ - getExclusionRecord(address) → ExclusionInfo       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              BountyMarket.sol                       │
├─────────────────────────────────────────────────────┤
│ - createBounty(rulingId, amount, deadline)          │
│ - claimBounty(bountyId, proofType, proof)           │
│ - verifyOracleAttestation(bountyId, attestations[]) │
│ - verifyLegacyCourtJudgment(bountyId, judgment)     │
│ - verifyDebtorConfirmation(bountyId, signature)     │
│ - disputeBountyClaim(bountyId, evidence)            │
└─────────────────────────────────────────────────────┘
```

### Bounty Verification (Priority Order)

1. **Oracle attestation** - 3-of-5 registered oracles attest to recovery (most trustless)
2. **Legacy court bridge** - Traditional court judgment submitted as proof (legally robust)
3. **Debtor confirmation** - Debtor signs tx confirming restitution received (fallback)

---

## 6. Insurance System

### Hybrid Model

**Protocol Baseline Pool**
- Funded by protocol fees and token inflation
- Provides minimum coverage to all participants
- Lower limits, standardized terms
- DAO governs pool parameters

**Open Market Supplemental**
- Anyone can become insurer by staking sufficient capital
- Set own premiums, coverage limits, underwriting criteria
- Compete on price, speed, and coverage terms
- Must maintain minimum reserve ratios

```
┌─────────────────────────────────────────────────────┐
│              BaselineInsurancePool.sol              │
├─────────────────────────────────────────────────────┤
│ - deposit(amount) [adds to pool]                    │
│ - getCoverage(address) → CoverageInfo               │
│ - fileClaim(rulingId)                               │
│ - processClaim(claimId) [auto or DAO]               │
│ - getPoolHealth() → (reserves, obligations, ratio)  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              InsurerRegistry.sol                    │
├─────────────────────────────────────────────────────┤
│ - registerInsurer(stake, terms, reserveProof)       │
│ - updateTerms(insurerId, newTerms)                  │
│ - getInsurer(insurerId) → InsurerInfo               │
│ - listInsurers(filters) → InsurerInfo[]             │
│ - slashInsurer(insurerId, amount, reason)           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              InsurancePolicy.sol                    │
├─────────────────────────────────────────────────────┤
│ - purchasePolicy(insurerId, coverage, duration)     │
│ - renewPolicy(policyId)                             │
│ - cancelPolicy(policyId)                            │
│ - getPolicy(policyId) → PolicyInfo                  │
│ - fileClaim(policyId, rulingId)                     │
└─────────────────────────────────────────────────────┘
```

### Tiered Access Based on Coverage

| Tier | Coverage | Capabilities |
|------|----------|--------------|
| **Uninsured** | None | Max 0.1 ETH contracts, 100% escrow required, limited visibility |
| **Baseline** | Protocol pool only | Max 1 ETH contracts, 50% escrow required |
| **Standard** | Baseline + supplemental | Max 10 ETH contracts, 25% escrow required |
| **Premium** | High-limit supplemental | Unlimited contracts, flexible escrow |

### Dynamic Pricing

Insurers query reputation scores to price premiums:
- Low compliance score → higher premium
- High dispute rate → higher premium or denial
- New participant → higher premium (no history)

---

## 7. DAO Governance & Token Economics

### Token: AEGIS

**Utilities:**
- Court staking (required to operate as arbitrator)
- Juror staking (required to join jury pool)
- Insurer staking (required to offer coverage)
- Governance voting
- Registry access fees (paid in AEGIS)

### Staking Yield Model

```
┌─────────────────────────────────────────────────────┐
│              StakingRewards.sol                     │
├─────────────────────────────────────────────────────┤
│ - stake(amount, role) [court/juror/insurer]         │
│ - unstake(amount) [timelock: 14 days]               │
│ - claimRewards()                                    │
│ - getStakeInfo(address) → StakeInfo                 │
│ - calculateRewards(address) → uint256               │
└─────────────────────────────────────────────────────┘
```

**Reward sources:**
- Dispute filing fees (70% to stakers, 30% to protocol treasury)
- Contract creation fees
- Insurance policy fees
- Registry listing fees

### On-Chain Constitutional Constraints

The DAO governance contract structurally prevents forbidden actions:

```
┌─────────────────────────────────────────────────────┐
│              AegisGovernor.sol                      │
├─────────────────────────────────────────────────────┤
│ FORBIDDEN FUNCTIONS (cannot be called via proposal):│
│ - No function to "define crimes"                    │
│ - No function to override signed contracts          │
│ - No function to grant immunity from rulings        │
│ - No function to compel participation               │
│                                                     │
│ ALLOWED FUNCTIONS:                                  │
│ - upgradeProtocol(newImplementation)                │
│ - updateFeeParameters(params)                       │
│ - addToExclusionRegistry(address, ruling)           │
│ - removeFromExclusionRegistry(address)              │
│ - pauseProtocol() [emergency only, timebound]       │
│ - updateRegistryRequirements(params)                │
└─────────────────────────────────────────────────────┘
```

### Slashing Conditions

| Actor | Slashable Offense | Slash % |
|-------|-------------------|---------|
| Court | Proven corruption, collusion | 100% |
| Court | Failure to rule within deadline | 10% |
| Juror | Voting with minority without justification | 5% |
| Juror | Proven collusion | 100% |
| Insurer | Failure to pay valid claim | 50-100% |
| Insurer | Reserve ratio violation | 25% |

### Governance Parameters

- Proposal threshold: 1% of staked supply
- Voting period: 7 days
- Timelock: 48 hours
- Quorum: 10% of staked supply

---

## 8. Smart Contract Summary

### L2 Contracts (Primary Operations)

| Contract | Purpose |
|----------|---------|
| `AegisIdentityRegistry.sol` | Identity registration, external linking |
| `ReputationScoring.sol` | Multi-dimensional reputation tracking |
| `ContractTemplateRegistry.sol` | Template management |
| `ContractFactory.sol` | Contract creation and signing |
| `CourtRegistry.sol` | Arbitrator registration and staking |
| `JurorPool.sol` | Jury staking and selection |
| `DisputeResolution.sol` | Dispute lifecycle management |
| `EnforcementEngine.sol` | Enforcement execution and escalation |
| `BountyMarket.sol` | Recovery bounty management |
| `BaselineInsurancePool.sol` | Protocol insurance pool |
| `InsurerRegistry.sol` | Private insurer registration |
| `InsurancePolicy.sol` | Policy management |
| `StakingRewards.sol` | Token staking and rewards |
| `AegisGovernor.sol` | DAO governance with constraints |
| `AegisToken.sol` | ERC-20 token |

### Mainnet Contracts (Anchoring)

| Contract | Purpose |
|----------|---------|
| `ExclusionRegistry.sol` | Permanent exclusion records |
| `RulingAnchor.sol` | Final ruling commitments |
| `EscrowVault.sol` | High-value escrow storage |

---

## 9. Implementation Phases

### Phase 1: Core MVP
- Identity registry
- Reputation scoring
- Contract templates (Service, Sale)
- Single arbitrator disputes
- Escrow enforcement
- Basic token staking

### Phase 2: Insurance & Appeals
- Baseline insurance pool
- Insurer registry
- Jury appeal system
- Full enforcement hierarchy
- Reputation-based pricing

### Phase 3: Advanced Features
- Bounty market
- Oracle network integration
- Legacy court bridge
- Cross-L2 deployment
- Mainnet anchoring

---

## 10. Open Questions for Implementation

1. **Oracle selection:** Which oracle network for bounty verification? Chainlink, UMA, custom?
2. **Randomness:** VRF source for jury selection? Chainlink VRF, RANDAO?
3. **IPFS pinning:** Who pays for pinning? Protocol, parties, or incentivized pinners?
4. **Upgrade mechanism:** UUPS, Transparent Proxy, or Diamond pattern?
5. **Cross-chain messaging:** Which bridge for L2↔mainnet? Native rollup bridge, LayerZero, Hyperlane?

---

## Appendix: Design Decisions Log

| Question | Options Considered | Decision |
|----------|-------------------|----------|
| Blockchain | Ethereum, Solana, Cosmos, Chain-agnostic | Ethereum/EVM |
| On-chain scope | Maximal, Hybrid, Minimal | Maximal |
| Scaling | Mainnet, L2-first, L2+anchor, App-rollup | L2 + mainnet anchoring |
| L2 target | Arbitrum, Optimism/Base, Multi-L2, Agnostic | L2 agnostic |
| Identity | Native, Existing, Hybrid | Hybrid |
| Arbitration | Single, Jury, Tiered, Marketplace | Tiered |
| Enforcement | Automatic, Court-directed, Creditor-initiated | Court-directed |
| Exclusion | Protocol, Registry, Service-provider, Economic | Registry-based (DAO) |
| Physical enforcement | Asset recovery, Bounty, Legacy, Out of scope | Bounty system |
| Bounty verification | Proof, Debtor, Oracle, Insurance | Oracle → Legacy → Debtor |
| Insurance market | Open, Curated, Protocol-native, Hybrid | Hybrid + Open market |
| Insurance requirement | Hard gate, Tiered, Counterparty choice, Staking alt | Tiered access |
| Contracts | Template, Modular, Free-form, Lawyer marketplace | Template-based |
| Reputation | Single score, Multi-dimensional, Categorical, Raw | Multi-dimensional |
| DAO constraints | Social, On-chain, Judicial review, Futarchy | On-chain enforcement |
| Token accrual | Fees, Staking yield, Burn, Utility only, Hybrid | Staking yield |
