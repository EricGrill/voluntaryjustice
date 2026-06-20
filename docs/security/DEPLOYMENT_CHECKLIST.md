# VoluntaryJustice Deployment Checklist

## Pre-Deployment Requirements

### Code Quality
- [x] 742 tests passing (0 pending)
- [x] Test coverage: 95.4% statements, 74.2% branches, 96.2% lines
- [x] Code compiles without warnings (Solidity 0.8.25)
- [x] Branch coverage 80%+ on core/insurance/governance contracts
- [ ] Branch coverage 80%+ on remaining contracts (BountyMarket, EnforcementEngine, …)
- [ ] Static analysis (Slither/Mythril) run and clean
- [ ] External security audit completed
- [ ] Bug bounty program established

### Documentation
- [x] README updated
- [x] Architecture document complete
- [x] Security audit report created
- [x] API documentation (contract ABIs)
- [ ] User documentation
- [ ] Operator runbook

### Infrastructure
- [ ] RPC endpoints configured (Alchemy/Infura)
- [ ] Deployer wallet funded
- [ ] Etherscan API key for verification
- [ ] Chainlink VRF subscription created
- [ ] Chainlink price feed addresses verified

---

## Testnet Deployment (Sepolia)

### Environment Setup
```bash
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
export PRIVATE_KEY="0x..."
export ETHERSCAN_API_KEY="..."
export CHAINLINK_VRF_COORDINATOR="0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625"
export CHAINLINK_VRF_KEY_HASH="0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c"
```

### Deployment Order

This mirrors `scripts/deploy-full.js`. Run it with `npx hardhat run scripts/deploy-full.js
--network <network>`; the steps below are for manual verification.

#### Phase 1: Core Infrastructure
1. [ ] Deploy VJToken
2. [ ] Deploy IdentityRegistry
3. [ ] Deploy ReputationScoring

#### Phase 2: Contract System
4. [ ] Deploy ContractTemplateRegistry
5. [ ] Deploy EscrowVault
6. [ ] Deploy ContractFactory (→ ContractTemplateRegistry, ReputationScoring)

#### Phase 3: Court System
7. [ ] Deploy CourtRegistry (→ VJToken)
8. [ ] Deploy JurorPool (→ VJToken)
9. [ ] Deploy StakingRewards (→ VJToken)
10. [ ] Deploy DisputeResolution (→ ContractFactory, CourtRegistry, ReputationScoring, VJToken)

#### Phase 4: Insurance
11. [ ] Deploy BaselineInsurancePool (→ VJToken, DisputeResolution)
12. [ ] Deploy InsurerRegistry (→ VJToken)
13. [ ] Deploy InsurancePolicy (→ VJToken, InsurerRegistry, DisputeResolution)

#### Phase 5: Enforcement & Exclusion
14. [ ] Deploy ExclusionRegistry
15. [ ] Deploy EnforcementEngine (→ DisputeResolution, EscrowVault, ReputationScoring, BaselineInsurancePool)
16. [ ] Deploy BountyMarket (→ VJToken, DisputeResolution)

#### Phase 6: Governance
17. [ ] Deploy `TimelockController` (OpenZeppelin)
18. [ ] Deploy VJGovernor (→ VJToken, TimelockController, ExclusionRegistry)
19. [ ] Grant the Timelock's PROPOSER_ROLE and EXECUTOR_ROLE to the Governor

#### Phase 7: Oracle & Bridges
20. [ ] Deploy OracleRegistry (→ VJToken)
21. [ ] Deploy LegacyCourtBridge
22. [ ] Deploy RulingAnchor
23. [ ] Deploy CrossChainBridge
24. [ ] Deploy VRFConsumer / wire VRF (or MockVRFCoordinator on non-mainnet)

### Post-Deployment Configuration

#### Role Setup
- [ ] Grant GOVERNANCE_ROLE to Governor/Timelock where applicable
- [ ] Grant OPERATOR_ROLE to operations wallet
- [ ] Transfer DEFAULT_ADMIN_ROLE to a multisig (no dedicated emergency-multisig contract exists yet)
- [ ] Revoke deployer admin roles

#### Contract Linking
- [ ] Wire DisputeResolution into ContractFactory / EnforcementEngine as required
- [ ] Wire EnforcementEngine into DisputeResolution
- [ ] Wire InsurancePolicy into EnforcementEngine
- [ ] Configure VRF subscription (VRFConsumer)

#### Initial Parameters
- [ ] Set minimum stakes (court, juror, insurer, oracle)
- [ ] Set timelock delay
- [ ] Set challenge / appeal periods

### Verification
```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

- [ ] All contracts verified on Etherscan
- [ ] ABIs match deployed bytecode

---

## Mainnet Deployment

### Additional Requirements
- [ ] Testnet deployment successful
- [ ] 2+ weeks testnet operation
- [ ] External audit complete
- [ ] Bug bounty active (30+ days)
- [ ] Multisig wallet created (Gnosis Safe)
- [ ] Emergency contacts established

### Mainnet-Specific Configuration
- [ ] Use production Chainlink addresses
- [ ] Higher minimum stakes
- [ ] Longer timelock delays
- [ ] Production fee recipients

### Post-Mainnet
- [ ] Transfer DEFAULT_ADMIN_ROLE to timelock/multisig
> Note: contracts are non-upgradeable (no proxy layer). A redeploy + migration is required to ship fixes.
- [ ] Announce deployment
- [ ] Monitor first transactions closely
- [ ] 24/7 monitoring for first week

---

## Rollback Plan

### If Critical Bug Found
> There is currently no global pause / circuit breaker. Containment options are limited to
> role revocation and parameter changes via governance. Adding an emergency pause is
> recommended before mainnet.
1. Revoke roles / freeze privileged operations where possible
2. Assess damage and scope
3. Prepare a redeploy + state migration (contracts are immutable)
4. Communicate with users
5. Execute fix with governance approval

### Emergency Contacts
- Lead Developer: [TBD]
- Security Lead: [TBD]
- Multisig Signers: [TBD]

---

## Monitoring Setup

### Metrics to Track
- Transaction success rate
- Gas usage patterns
- Contract balance changes
- Role grant/revoke events
- Governance proposal / timelock events
- Unusual patterns (large transfers, rapid disputes)

### Alerting
- [ ] Set up Tenderly/Defender alerts
- [ ] Configure PagerDuty/Discord webhooks
- [ ] Monitor Chainlink oracle health
- [ ] Track governance proposal activity
