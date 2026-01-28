# Aegis Smart Contract Implementation

You are building the Aegis Polycentric Justice DAO smart contracts.

## Architecture Reference

See `docs/plans/2026-01-28-aegis-architecture-design.md` for full architecture.

## Current Phase

Check `PROGRESS.md` to see current status. If it doesn't exist, start with Phase 1.

## Phase 1: Core MVP

Build these contracts in order:

### 1. AegisToken.sol
- ERC-20 token with staking hooks
- Minting controlled by governance
- 18 decimals, symbol: AEGIS

### 2. AegisIdentityRegistry.sol
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
- Courts must stake AEGIS tokens

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

## Output

When Phase 1 is complete and all tests pass, output:
```
<promise>PHASE 1 COMPLETE</promise>
```

When Phase 2 is complete and all tests pass, output:
```
<promise>PHASE 2 COMPLETE</promise>
```
