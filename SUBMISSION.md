# Arc Microgrants submission draft

Fill in the bracketed parts, then paste each section into the form.

---

**Project name**
Heirloom

**Live deployment (link)**
https://ogharka.github.io/heirloom/

**Contract on Arc mainnet**
https://explorer.arc.io/address/0x2e7707D2723B14bD5cfA5766C11b198EE84E4aC9

**Public repo**
https://github.com/ogharka/heirloom

**Builder profile**
https://github.com/ogharka (and/or your X or Farcaster profile)

**What it does (short description)**

Heirloom is a USDC inheritance vault, a dead man's switch for stablecoins. You lock USDC in a vault, name up to 10 heirs with percentage shares, and check in now and then. If you miss your check-in window, each heir can claim their share directly to their own wallet. There's no custodian, no lawyer and no seed phrase to hand over. A false alarm is recoverable: until the first heir claims, the owner can still check in.

It's live on Arc mainnet. The full cycle (create, miss the check-in, heir claims) has been run on mainnet: [claim transaction link].

**What it uses Arc for**

Inheritance is a long-horizon promise to people who often aren't crypto users, and Arc fits that better than any other chain:
- Heirs inherit dollars, not a volatile token, because the vault holds USDC, Arc's native asset.
- Gas is USDC too, so an heir who receives USDC can claim it without first buying a separate gas token.
- Dollar-denominated fees make the cost of each check-in tiny and predictable.
- Deterministic sub-second finality means a check-in is final on inclusion, with no reorg race between a last-minute check-in and a claim.

The contract is written for Arc's runtime. It uses native USDC (18 decimals) with no ERC-20 approvals, and payouts are pull-based so a native transfer that reverts (for example, a blocklisted heir) never blocks the other heirs. There's no admin key, no upgrade path and no pause, so not even the deployer can touch vault funds. It has 18 Foundry tests, including re-entrancy attack tests and fuzz tests, plus a clean Slither run, and the source is verified on the Arc explorer. The web app loads no third-party scripts and locks network access to Arc's RPC with a strict Content-Security-Policy.

**What's next (if asked)**

Cross-chain claims with CCTP and Gateway so heirs receive USDC on the chain they already use, deadline reminders by email or Telegram, an optional guardian who confirms before release, and confidential vault balances once Arc's opt-in privacy is live.
