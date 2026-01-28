# VoluntaryJustice Deployment Checklist

## Pre-Deployment Requirements

### Code Quality
- [x] All 624 tests passing
- [x] Test coverage: 84.7% statements, 85.4% lines
- [x] Code compiled without warnings
- [x] ESLint/Solhint checks passed
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

#### Step 1: Core Infrastructure
1. [ ] Deploy VJToken
2. [ ] Deploy IdentityRegistry
3. [ ] Deploy ReputationScoring
4. [ ] Deploy ParameterRegistry

#### Step 2: Contract System
5. [ ] Deploy ContractTemplateRegistry
6. [ ] Deploy EscrowVault
7. [ ] Deploy ContractFactory

#### Step 3: Court System
8. [ ] Deploy CourtRegistry
9. [ ] Deploy JurorPool
10. [ ] Deploy VRFConsumer
11. [ ] Deploy DisputeResolution

#### Step 4: Enforcement
12. [ ] Deploy EnforcementEngine
13. [ ] Deploy ExclusionRegistry
14. [ ] Deploy BountyMarket

#### Step 5: Insurance
15. [ ] Deploy BaselineInsurancePool
16. [ ] Deploy InsurerRegistry
17. [ ] Deploy InsurancePolicy

#### Step 6: Governance
18. [ ] Deploy GovernorTimelock
19. [ ] Deploy VJGovernor
20. [ ] Deploy ConstitutionalConstraints
21. [ ] Deploy EmergencyMultisig

#### Step 7: Production Infrastructure
22. [ ] Deploy CircuitBreaker
23. [ ] Deploy RateLimiter
24. [ ] Deploy AuditLog
25. [ ] Deploy ProtocolFees

#### Step 8: Oracles & Bridges
26. [ ] Deploy PriceOracle
27. [ ] Deploy LegacyCourtBridge

### Post-Deployment Configuration

#### Role Setup
- [ ] Grant GOVERNANCE_ROLE to Governor
- [ ] Grant PAUSER_ROLE to EmergencyMultisig
- [ ] Grant OPERATOR_ROLE to operations wallet
- [ ] Revoke deployer admin roles

#### Contract Linking
- [ ] Set DisputeResolution in ContractFactory
- [ ] Set EnforcementEngine in DisputeResolution
- [ ] Set InsurancePolicy in EnforcementEngine
- [ ] Configure VRF subscription
- [ ] Configure price feeds

#### Initial Parameters
- [ ] Set minimum stakes (court, juror, insurer)
- [ ] Set fee percentages
- [ ] Set timelock delays
- [ ] Set circuit breaker thresholds

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
- [ ] Transfer ProxyAdmin to multisig
- [ ] Transfer DEFAULT_ADMIN_ROLE to timelock
- [ ] Announce deployment
- [ ] Monitor first transactions closely
- [ ] 24/7 monitoring for first week

---

## Rollback Plan

### If Critical Bug Found
1. Pause all pausable contracts
2. Assess damage and scope
3. Prepare upgrade or migration
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
- Pause/unpause events
- Unusual patterns (large transfers, rapid disputes)

### Alerting
- [ ] Set up Tenderly/Defender alerts
- [ ] Configure PagerDuty/Discord webhooks
- [ ] Monitor Chainlink oracle health
- [ ] Track governance proposal activity
