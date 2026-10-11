# Heirloom

**USDC inheritance vaults on Arc. If you go quiet, your USDC goes home.**

Every year, crypto is lost because the only person who held the keys dies or becomes unreachable. Heirloom is a dead man's switch for stablecoins:

1. **Lock USDC** in a vault and name up to 10 heirs with percentage shares.
2. **Check in** now and then. One transaction resets the timer. You can add USDC, withdraw, or change heirs at any time, and each of those also counts as a check-in.
3. **Heirs claim.** If you miss your check-in window, each heir can claim their own share straight to their wallet.

No custodian, no lawyer, and no seed phrase to hand over.

- **Live app:** `https://ogharka.github.io/heirloom/`
- **Contract on Arc mainnet:** `<contract address>` ([explorer](https://explorer.arc.io))

## Why Arc

Heirloom is built around what Arc does differently:

- **Heirs inherit dollars.** Inheritance is a long-horizon promise. A vault of a volatile token can lose half its value before anyone claims it. On Arc, the vault holds USDC, Arc's native asset.
- **Heirs need only one asset.** Gas on Arc is paid in USDC, so a non-crypto relative who receives an address with some USDC can claim right away. They don't need to buy ETH or another gas token first. For inheritance, where heirs are often not crypto users, this matters a lot.
- **Costs are predictable.** Fees are dollar-denominated, so the cost of "staying alive" with a check-in is known in advance and stays tiny.
- **Finality is instant.** A check-in is final on inclusion (sub-second, deterministic). There's no window where a last-second check-in might be reorged out while heirs claim.

## How it works

`src/Heirloom.sol` is a single contract that holds many vaults.

| Function | Who | What it does |
|---|---|---|
| `createVault(name, heirs, bps, interval)` | anyone | Creates a vault, deposits any USDC sent, and starts the timer |
| `checkIn(id)` | owner | Proof of life that resets the timer |
| `deposit(id)` / `withdraw(id, amount)` | owner | Moves USDC in or out (also counts as a check-in) |
| `setHeirs` / `setInterval` | owner | Updates the plan (also counts as a check-in) |
| `claim(id)` | heir | After the deadline, pays this heir's share |
| `getVault`, `vaultsOf`, `vaultsAsHeir`, `vaultCount` | anyone | Read-only views used by the app |

Design decisions:

- **Native USDC, no approvals.** Vaults hold Arc's native USDC (`msg.value`, 18 decimals), so creating and funding a vault is one transaction.
- **Pull-based payouts.** On Arc, a native transfer can revert (for example, to a blocklisted address). Each heir claims separately, so one heir who can't receive never blocks the others. This is covered by a test.
- **A false alarm is recoverable.** If the deadline passes but no heir has claimed yet, the owner can still check in and reclaim control. Once the first heir claims, the vault is frozen and the balance is snapshotted, so every heir gets an exact share of the same total.
- **Share rounding never overpays.** A fuzz test checks that payouts never exceed the deposit and lose at most 1 wei to rounding.
- **No stray funds.** The contract rejects plain transfers, so every USDC in it belongs to a vault.
- Shares are in basis points and must total 100%. Check-in windows run from 1 minute (handy for live demos) to 10 years.

## Repo layout

```
src/Heirloom.sol         the contract
test/                    Foundry tests (18, including attack and fuzz tests)
verify/                  standard JSON input for source verification on the explorer
docs/                    the web app (static, served by GitHub Pages)
  index.html, app.js     the app: create, check in, deposit/withdraw, claim, public lookup
  deploy.html, deploy.js deploys the contract from a browser wallet (no private keys in code)
  contract.js            ABI + bytecode compiled from verify/Heirloom.standard-input.json
  config.js              deployed contract address
  vendor/                pinned local copy of viem, so no third-party scripts load
```

## Run the tests

```bash
forge install foundry-rs/forge-std --no-git
forge test
```

## Run the app locally

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000/?contract=<address>
```

## Status and safety

The contract has no admin key, no upgrade path and no pause, so nobody (including the deployer) can touch vault funds. The web app loads no third-party scripts and enforces a strict Content-Security-Policy. See [SECURITY.md](SECURITY.md) for the full model and what was tested.

This is a proof of concept. The contract is unaudited, so only lock amounts you're comfortable testing with.

Ideas for later: Circle Gateway or CCTP so heirs can claim on the chain they already use, email or Telegram reminders before a deadline, a guardian or co-signer who can confirm a death before release, and confidential balances once Arc's opt-in privacy ships.

## License

MIT
