# Security

## What the contract can and cannot do

- **No admin, no owner of the contract, no upgrade, no pause.** Whoever deploys Heirloom gets no special powers. Once it's deployed, nobody, including the deployer or the authors, can move funds out of a vault except through the rules below.
- **Only a vault's owner** can withdraw, change heirs or change the check-in window, and only before the first heir claims.
- **Only a named heir** can claim, only after the owner has missed the deadline, and only their own share, once.
- **No token approvals.** Heirloom uses Arc's native USDC (`msg.value`). It never asks your wallet for `approve`, `permit` or any signature that lets a contract spend your money later. Connecting your wallet can't drain anything you didn't deliberately send in.
- **Payouts are pull-based and protected against re-entry.** State is updated before USDC is sent, and `claim` and `withdraw` carry a re-entrancy lock.
- **The contract rejects stray transfers.** USDC forced in by other means doesn't change what any heir receives.

## How it was checked

- 18 Foundry tests, including fuzz tests:
  - The full inheritance flow, deadlines, the false-alarm revive, access control and input validation.
  - Attack tests: a malicious heir re-entering `claim`, a malicious owner re-entering `withdraw`, strangers calling owner functions, and USDC forced into the contract.
  - Invariants: payouts never exceed deposits (1 wei rounding at most), and the contract's balance always equals the sum of vault balances.
- Slither static analysis. There are no open findings, and the remaining notes are expected for the design: sending USDC to the claiming heir, using a timestamp for deadlines, and a low-level call for native transfers.
- **The contract is not audited.** Treat it as a proof of concept and only lock small amounts.

## Web app hardening

- **No third-party JavaScript.** viem (pinned at 2.57.4, with 0 known vulnerabilities at build time) is bundled into `docs/vendor/`. A compromised CDN can't inject code into the app.
- **Content-Security-Policy:** scripts load only from the site itself, and network requests go only to Arc's official RPC. The page can't send data to any other server.
- All on-chain text, such as vault names, is escaped before display, so a malicious vault name can't inject code.
- Arc mainnet is enforced. The deploy page refuses to continue unless the wallet reports chain 5042.

## What the site never does

It never asks for a seed phrase, private key or password, never asks you to sign a message to "verify" your wallet, and never links you to another site to claim. If you see any of that, it isn't Heirloom.

## Supply chain

| File | SHA-256 |
|---|---|
| `docs/vendor/viem-2.57.4.js` | `efae53b1f7e44aad42f351c39c0f4b5c010fa2afe8b24838f75d928204c03547` |

Built from the npm registry tarball `viem-2.57.4.tgz` with esbuild, exporting only the functions the app uses.

## Reporting a problem

Open a GitHub issue. Don't include any secrets in it.
