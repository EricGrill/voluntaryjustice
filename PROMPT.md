# VoluntaryJustice Smart Contract Implementation

You are building the VoluntaryJustice Polycentric Justice DAO smart contracts.
Domain: voluntaryjustice.com

## Architecture Reference

See `docs/plans/2026-01-28-aegis-architecture-design.md` for full architecture.
(Note: Design doc uses working name "Aegis" - the project is now called VoluntaryJustice)

## Current Phase

Check `PROGRESS.md` to see current status. If it doesn't exist, start with Phase 1.

## Phase 1: Core MVP

Build these contracts in order:

### 1. VJToken.sol
- ERC-20 token with staking hooks
- Minting controlled by governance
- 18 decimals, symbol: VJ

### 2. IdentityRegistry.sol
- `registerIdentity(address, bytes sybilProof)` - register new identity
- `linkExternalIdentity(address, string identityType, bytes proof)` - link ENS, EAS, etc.
- `getIdentity(address) → IdentityProfile` - get identity info
- `isRegistered(address) → bool`

### 3. ReputationScoring.sol
- Four scores: compliance (0-100), disputeRate (0-100 inverse), paymentHistory (0-100), counterpartyRating (0-100)
- `updateCompliance(address, uint256 rulingId, bool complied)`
- `recordDispute(address, uint256 contractId)`
- `recordPayment(address, uint256 amount, uint256 daysToSettle)`
- `submitRating(address from, address to, uint8 score)`
- `getScores(address) → (uint8, uint8, uint8, uint8)`
- Only callable by authorized contracts (ContractFactory, DisputeResolution, EnforcementEngine)

### 4. ContractTemplateRegistry.sol
- `registerTemplate(bytes32 templateHash, string metadata, address defaultArbitrator)`
- `getTemplate(uint256 templateId) → TemplateInfo`
- `listTemplates() → TemplateInfo[]`
- Only DAO can register templates

### 5. ContractFactory.sol
- `createContract(uint256 templateId, bytes params, address[] parties) → uint256 contractId`
- `signContract(uint256 contractId)`
- `getContract(uint256 contractId) → ContractState`
- `getContractsByParty(address) → uint256[]`
- Contract states: Draft, PendingSignatures, Active, Disputed, Completed, Terminated

### 6. CourtRegistry.sol
- `registerCourt(string metadata, uint256 stake, bytes32 rulesetHash)`
- `getCourt(uint256 courtId) → CourtInfo`
- `listCourts() → CourtInfo[]`
- `slashCourt(uint256 courtId, uint256 amount, string reason)` - only by governance
- `withdrawStake(uint256 courtId)` - 14 day timelock
- Courts must stake VJ tokens

### 7. DisputeResolution.sol
- `fileDispute(uint256 contractId, string claim, bytes32 evidenceHash) → uint256 disputeId`
- `submitEvidence(uint256 disputeId, bytes32 evidenceHash)`
- `submitRuling(uint256 disputeId, bytes ruling, bytes enforcement)` - only assigned court
- `finalizeRuling(uint256 disputeId)`
- Dispute states: Filed, Evidence, Ruling, Finalized
- Integrates with ReputationScoring

### 8. EscrowVault.sol
- `deposit(uint256 contractId) payable`
- `release(uint256 contractId, address recipient, uint256 amount)` - only EnforcementEngine
- `refund(uint256 contractId, address recipient)` - only on contract cancellation
- `getBalance(uint256 contractId) → uint256`

### 9. StakingRewards.sol
- `stake(uint256 amount, StakeRole role)` - role: Court, Juror, Insurer
- `unstake(uint256 amount)` - 14 day timelock
- `claimRewards()`
- `getStakeInfo(address) → StakeInfo`
- `distributeRewards(uint256 amount)` - called when fees collected

## Phase 2: Insurance & Appeals (after Phase 1 passes)

### 10. JurorPool.sol
- `stakeAsJuror(uint256 amount)`
- `unstake(uint256 amount)` - 14 day timelock
- `drawJury(uint256 disputeId, bytes32 seed) → address[5]` - random selection
- `slashJuror(address, uint256 amount, string reason)`
- VRF for randomness

### 11. BaselineInsurancePool.sol
- `deposit(uint256 amount)` - add to pool
- `getCoverage(address) → CoverageInfo`
- `fileClaim(uint256 rulingId)`
- `processClaim(uint256 claimId)`
- `getPoolHealth() → (uint256 reserves, uint256 obligations, uint256 ratio)`

### 12. InsurerRegistry.sol
- `registerInsurer(uint256 stake, bytes terms, bytes reserveProof)`
- `updateTerms(uint256 insurerId, bytes newTerms)`
- `getInsurer(uint256 insurerId) → InsurerInfo`
- `listInsurers() → InsurerInfo[]`
- `slashInsurer(uint256 insurerId, uint256 amount, string reason)`

### 13. InsurancePolicy.sol
- `purchasePolicy(uint256 insurerId, uint256 coverage, uint256 duration)`
- `renewPolicy(uint256 policyId)`
- `cancelPolicy(uint256 policyId)`
- `getPolicy(uint256 policyId) → PolicyInfo`
- `fileClaim(uint256 policyId, uint256 rulingId)`

### 14. EnforcementEngine.sol (enhanced)
- Add insurance claim triggering
- Add appeal integration

### 15. DisputeResolution.sol (enhanced)
- Add `appeal(uint256 disputeId, uint256 stake)`
- Add `submitJuryVote(uint256 disputeId, bytes32 voteCommitment)`
- Add `revealJuryVote(uint256 disputeId, bytes32 vote, bytes32 salt)`
- Add jury deliberation flow

## Testing Requirements

Each contract needs:
1. Unit tests for all public functions
2. Access control tests (only authorized callers)
3. Edge case tests (zero values, max values, reentrancy)
4. Integration tests with dependent contracts

Use Hardhat + Chai + ethers.js for testing.

## Progress Tracking

After each iteration:
1. Update `PROGRESS.md` with what was completed
2. List any compilation errors to fix
3. List any failing tests to fix
4. Note next contract to implement

## Completion Criteria

Phase 1 complete when:
- All 9 Phase 1 contracts compile without errors
- All Phase 1 tests pass
- `npm run test` exits with code 0

Phase 2 complete when:
- All Phase 2 contracts compile
- All Phase 2 tests pass
- Full integration tests pass

## Phase 3: Enforcement & Exclusion (after Phase 2 passes)

### 16. ExclusionRegistry.sol
- `addToRegistry(address, bytes32 rulingHash, string reason)` - only governance
- `removeFromRegistry(address)` - only governance (DAO vote)
- `isExcluded(address) → bool`
- `getExclusionRecord(address) → ExclusionInfo`
- Permanent exclusion records for non-compliance

### 17. BountyMarket.sol
- `createBounty(uint256 rulingId, uint256 amount, uint256 deadline)`
- `claimBounty(uint256 bountyId, ProofType proofType, bytes proof)`
- `verifyOracleAttestation(uint256 bountyId, bytes[] attestations)`
- `verifyLegacyCourtJudgment(uint256 bountyId, bytes judgment)`
- `verifyDebtorConfirmation(uint256 bountyId, bytes signature)`
- `disputeBountyClaim(uint256 bountyId, bytes evidence)`
- Bounty verification priority: Oracle → Legacy courts → Debtor confirmation

## Phase 4: Governance & Anchoring (after Phase 3 passes)

### 18. VJGovernor.sol
- OpenZeppelin Governor with constitutional constraints
- `propose(targets[], values[], calldatas[], description)`
- `castVote(uint256 proposalId, uint8 support)`
- `execute(targets[], values[], calldatas[], descriptionHash)`
- FORBIDDEN FUNCTIONS (structurally cannot be called):
  - No "define crimes" function
  - No override signed contracts function
  - No grant immunity function
  - No compel participation function
- ALLOWED FUNCTIONS:
  - `upgradeProtocol(address newImplementation)`
  - `updateFeeParameters(bytes params)`
  - `pauseProtocol()` - emergency only, timebound
  - `updateRegistryRequirements(bytes params)`
- Integration with ExclusionRegistry for add/remove
- Governance parameters: 1% proposal threshold, 7 day voting, 48h timelock, 10% quorum

### 19. RulingAnchor.sol
- `anchorRuling(uint256 disputeId, bytes32 rulingHash)`
- `verifyAnchor(uint256 disputeId, bytes32 rulingHash) → bool`
- `getAnchor(uint256 disputeId) → AnchorInfo`
- Mainnet anchoring of final rulings for permanence
- Cross-L2 verification support

## Output

When Phase 1 is complete and all tests pass, output:
```
<promise>PHASE 1 COMPLETE</promise>
```

When Phase 2 is complete and all tests pass, output:
```
<promise>PHASE 2 COMPLETE</promise>
```

When Phase 3 is complete and all tests pass, output:
```
<promise>PHASE 3 COMPLETE</promise>
```

When Phase 4 is complete and all tests pass, output:
```
<promise>PHASE 4 COMPLETE</promise>
```

## Phase 5: Oracle & Legacy Integration (after Phase 4 passes)

### 20. OracleRegistry.sol
- `registerOracle(address oracle, string metadata, uint256 stake)` - register as oracle
- `updateOracleMetadata(uint256 oracleId, string metadata)`
- `slashOracle(uint256 oracleId, uint256 amount, string reason)` - governance only
- `deactivateOracle(uint256 oracleId)` - self or governance
- `getOracle(uint256 oracleId) → OracleInfo`
- `listActiveOracles() → OracleInfo[]`
- `submitAttestation(uint256 bountyId, bytes32 attestationHash)` - oracle attests to recovery
- `getAttestations(uint256 bountyId) → Attestation[]`
- `hasQuorum(uint256 bountyId) → bool` - 3-of-5 oracles required
- Oracles must stake VJ tokens to participate

### 21. LegacyCourtBridge.sol
- `registerJurisdiction(string name, bytes32 verificationKey)` - governance only
- `submitJudgment(uint256 bountyId, bytes judgment, bytes32 jurisdictionId)`
- `verifyJudgment(uint256 submissionId) → bool`
- `challengeJudgment(uint256 submissionId, bytes evidence)` - dispute period
- `finalizeJudgment(uint256 submissionId)`
- `getJudgment(uint256 submissionId) → JudgmentInfo`
- Bridge between traditional legal system and on-chain enforcement
- Supports multiple jurisdictions with different verification methods

When Phase 5 is complete and all tests pass, output:
```
<promise>PHASE 5 COMPLETE</promise>
```
