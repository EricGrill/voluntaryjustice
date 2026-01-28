# VoluntaryJustice Frontend Design

**Date:** 2026-01-28
**Status:** Approved
**Version:** 1.0

---

## Overview

Frontend application for the VoluntaryJustice Polycentric Justice DAO, providing interfaces for contract management, dispute resolution, insurance, court registry, and governance.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router) |
| Wallet | RainbowKit + wagmi v2 |
| Styling | shadcn/ui + Tailwind CSS |
| State | TanStack Query + Zustand |
| Forms | React Hook Form + zod |
| Testing | Vitest + React Testing Library + Playwright |

---

## Project Structure

```
frontend/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/       # Dashboard layout group
│   │   ├── page.tsx       # Home/overview
│   │   ├── contracts/     # My contracts
│   │   ├── disputes/      # Dispute management
│   │   ├── insurance/     # Insurance policies
│   │   ├── courts/        # Court registry
│   │   └── governance/    # DAO proposals
│   └── layout.tsx         # Root layout with providers
├── components/
│   ├── ui/                # shadcn components
│   └── features/          # Domain components
├── lib/
│   ├── contracts/         # ABIs + typed hooks
│   ├── wagmi.ts          # Chain config
│   └── utils.ts
└── types/                 # Shared types
```

---

## Core Pages

### Dashboard (Home)
- Overview cards: Active contracts, Open disputes, Insurance coverage, VJ balance
- Recent activity feed (contract signings, dispute updates, payments)
- Quick actions: Create contract, File dispute, Buy insurance

### Contracts Page
- List of user's contracts with status filters (Draft, Active, Disputed, Completed)
- Contract detail view: parties, terms, escrow balance, dispute history
- Create contract flow: select template → fill params → invite parties → sign

### Disputes Page
- Active disputes where user is claimant or respondent
- Dispute detail view: timeline, evidence submissions, ruling status
- File dispute modal: select contract → describe claim → attach evidence hash
- Evidence submission interface
- Appeal flow (if eligible)

### Insurance Page
- Current policies with coverage details and expiration
- Browse insurers: filter by premium, coverage limits, reputation
- Purchase policy flow: select insurer → choose coverage → pay premium
- File claim interface (links to ruling)

### Courts Page
- Browse registered courts with stake amounts and rulesets
- Court detail: operator, cases handled, success rate
- Register as court flow (for arbitrators)

### Governance Page
- Active proposals with voting status
- Proposal detail: description, votes for/against, time remaining
- Cast vote interface
- Create proposal (if threshold met)

---

## Component Structure

### Layout Components
- `RootLayout` - Providers (wagmi, RainbowKit, QueryClient, ThemeProvider)
- `DashboardLayout` - Sidebar navigation + header with wallet button
- `PageHeader` - Title, description, action buttons

### Shared UI Patterns
- `DataTable` - Sortable, filterable tables
- `StatusBadge` - Color-coded status pills
- `AddressDisplay` - Truncated address with ENS + copy
- `TokenAmount` - Formatted VJ/ETH amounts
- `TransactionButton` - Handles pending/confirming/success states
- `Timeline` - Vertical timeline for history

### Feature Components

```
components/features/
├── contracts/
│   ├── ContractCard.tsx
│   ├── ContractList.tsx
│   ├── CreateContractModal.tsx
│   └── SignContractButton.tsx
├── disputes/
│   ├── DisputeCard.tsx
│   ├── DisputeTimeline.tsx
│   ├── FileDisputeModal.tsx
│   ├── SubmitEvidenceForm.tsx
│   └── AppealButton.tsx
├── insurance/
│   ├── PolicyCard.tsx
│   ├── InsurerBrowser.tsx
│   └── PurchasePolicyModal.tsx
├── courts/
│   ├── CourtCard.tsx
│   └── RegisterCourtForm.tsx
└── governance/
    ├── ProposalCard.tsx
    ├── VoteButtons.tsx
    └── CreateProposalModal.tsx
```

---

## Contract Integration

### Type Generation

Build script copies ABIs and generates typed hooks:

```bash
npm run generate:contracts
# 1. Copies ABIs from artifacts/ to frontend/lib/contracts/abis/
# 2. Generates typed hooks using wagmi CLI
```

### Contract Hooks Structure

```
lib/contracts/
├── abis/                    # Copied from artifacts
├── addresses.ts             # Deployed addresses by chain
├── hooks/                   # Typed wagmi hooks
└── index.ts
```

### Chain Configuration

| Environment | Chain | Notes |
|-------------|-------|-------|
| Development | Hardhat (31337) | Local node |
| Testnet | Sepolia (11155111) | Deployed contracts |
| Production | Mainnet + L2s | Arbitrum, Optimism, Base |

---

## Error Handling

### Error Message Mapping

```tsx
const errorMessages = {
  "Contract does not exist": "This contract was not found",
  "Not a party": "You're not authorized for this contract",
  "Insufficient stake": "You need more VJ tokens staked",
  "user rejected": "Transaction cancelled",
};
```

### Loading Patterns
- Page-level: Next.js `loading.tsx` with skeletons
- Component-level: Suspense with shimmer placeholders
- Transaction: Spinner → "Confirming..." → success/error toast

---

## Testing Strategy

| Type | Tool | Scope |
|------|------|-------|
| Unit | Vitest | Utility functions, hooks |
| Component | React Testing Library | UI logic |
| E2E | Playwright | Full flows against Hardhat |
| Contract mocks | wagmi mock connector | Deterministic tests |

---

## Accessibility

- shadcn/ui provides ARIA attributes
- Keyboard navigation for all elements
- WCAG AA color contrast
- Screen reader announcements for transactions
