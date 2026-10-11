# Launch Heirloom on Arc mainnet, safely

No coding and no terminal needed. Plan for about an hour. Finish by **October 13** so you have a buffer before the deadline (October 14 at 23:59 ET, which is October 15 at 9:44 AM in Nepal).

## Why this setup is safe

Wallets usually get drained while building with AI because a **private key or seed phrase ends up in a file** (`.env`, config, a script) that gets pushed to GitHub. Bots scan GitHub around the clock and sweep a wallet within seconds of a key appearing.

This project is built so that can't happen:

- **No private key exists anywhere in the project.** You deploy by clicking a button and approving in your wallet. Your key never leaves the wallet.
- **You never install or run anything on your Mac.** There's no npm, no scripts and no terminal. You only upload files through the GitHub website.
- **The project files contain no secrets.** They were scanned with gitleaks plus a manual check.
- **The contract has no admin key.** Even the deployer wallet can't touch anyone's vault, so that wallet isn't a target later.

## The rules (please read)

1. **Never type, paste, photograph or save your seed phrase** in any file, chat (including this one), note app, email or screenshot. Write it on paper only.
2. **Never sign anything you don't understand.** For this project, your wallet should only ever show a contract deployment, a call to the Heirloom contract, or a plain amount of USDC sent to the Heirloom contract. **Reject** anything that says `approve`, `permit`, `setApprovalForAll`, "sign message to verify", or sends funds to some other address.
3. **Nobody from Arc, Circle or GitHub will ever ask for your seed phrase**, or ask you to "verify your wallet" on some site. After you submit, expect fake "Arc team" DMs on X and Telegram. Ignore them. Payout verification happens only through the official program.

## Step 0: Clean start, because your old wallet was hacked

Your last hack may have come from malware on your Mac, not just from GitHub. Before you start:

- **Don't use or import the hacked wallet or its seed phrase.** Treat it as burned.
- Update macOS (System Settings, then General, then Software Update).
- In Chrome, open `chrome://extensions` and **remove any extension you don't recognize**. Fake wallet extensions are common. Your wallet extension should come from the official site (metamask.io or rabby.io).
- **Best option:** use a hardware wallet (Ledger or Trezor) connected to MetaMask or Rabby. Then even malware on your Mac can't sign transactions without you pressing the device.
- If you don't have one, **create a brand-new wallet with a new seed phrase**, written on paper.

## Step 1: Make two fresh wallets

In your wallet, create two **new** accounts:

| Name | Purpose | Holds |
|---|---|---|
| **Heirloom Deployer** | Deploys the contract and owns your demo vaults | About 5 USDC on Arc, nothing else |
| **Heirloom Heir** | The demo heir that claims | Starts empty. Heirs need a little USDC for gas, so send it 0.2 USDC |

Never keep your savings in either one. If something goes wrong, the most you can lose is the few USDC in them.

Add Arc to the wallet (Settings, then Networks, then Add network manually). Check every field carefully:

| Field | Value |
|---|---|
| Network name | Arc |
| RPC URL | https://rpc.mainnet.arc.io |
| Chain ID | 5042 |
| Currency symbol | USDC |
| Explorer | https://explorer.arc.io |

To get USDC on Arc: if your exchange lists **Arc** as a USDC withdrawal network, withdraw about 5.5 USDC to the Deployer address. Otherwise, bridge from another chain using a bridge listed on **docs.arc.io** (type that address yourself and don't follow links from DMs). **Send a 1 USDC test first**, confirm it arrives, then send the rest.

## Step 2: Secure your GitHub account

1. Sign up at github.com with a **unique password** you don't use anywhere else.
2. **Turn on two-factor authentication** (Settings, then Password and authentication). Use an authenticator app, not SMS. This matters: anyone who takes over your GitHub could change the website code.

## Step 3: Upload the code

1. Unzip `heirloom.zip` on your Mac. **Check the folder holds exactly these files** and nothing else:
   ```
   .gitignore  DEPLOY.md  LICENSE  README.md  SECURITY.md  SUBMISSION.md  foundry.toml
   src/Heirloom.sol
   test/Heirloom.t.sol  test/HeirloomAttack.t.sol
   verify/Heirloom.standard-input.json
   docs/.nojekyll  docs/app.js  docs/chain.js  docs/config.js  docs/contract.js
   docs/deploy.html  docs/deploy.js  docs/index.html  docs/style.css
   docs/vendor/viem-2.57.4.js
   ```
   Files starting with a dot are hidden in Finder. Press Cmd+Shift+. to show them.
2. On GitHub, click **New repository**, name it `heirloom`, make it **Public**, and leave every box unticked. Create it.
3. Click **uploading an existing file**, drag everything inside the `heirloom` folder into the page, and click **Commit changes**.
4. Go to **Settings**, then **Advanced Security** (or **Code security**), and turn on **Secret Protection** and **Push protection** if they're available. GitHub will then block any future upload that contains a key.

## Step 4: Turn on the website

1. Go to **Settings**, then **Pages**. Set Source to **Deploy from a branch**, Branch to **main**, and folder to **/docs**. Click Save.
2. After 1 to 2 minutes, your site is at `https://YOUR-USERNAME.github.io/heirloom/`. It must start with **https**.

## Step 5: Deploy the contract on mainnet

1. In your wallet, select the **Heirloom Deployer** account.
2. Open `https://YOUR-USERNAME.github.io/heirloom/deploy.html` and click **Deploy to Arc mainnet**.
3. **Before approving, check the wallet popup:**
   - Network: **Arc** (chain 5042)
   - Type: **Contract deployment** (or "Deploy a contract")
   - Amount sent: **0 USDC**
   - Gas fee: well under 1 USDC

   If anything differs, **reject** and message me.
4. Approve it. Copy the **contract address** the page shows. It's public and safe to share.

## Step 6: Point the app at your contract

1. On GitHub, open `docs/config.js` and click the pencil icon.
2. Paste the address between the quotes after `mainnet:`, for example `mainnet: "0xAbC…",`
3. Click **Commit changes** and wait a minute.

Or send me the address and I'll give you the exact file.

## Step 7: Publish the source on the explorer

This lets anyone read the exact code behind your contract, which builds trust with reviewers.

1. Open `https://explorer.arc.io/address/YOUR-CONTRACT-ADDRESS` and find **Verify & Publish** (on the Contract tab).
2. Choose **Solidity (Standard JSON input)**, compiler **v0.8.30**, and upload `verify/Heirloom.standard-input.json` from the unzipped folder.
3. If it asks for a contract name, enter `src/Heirloom.sol:Heirloom`. Leave constructor arguments empty.

If the explorer's screens look different, send me a screenshot and I'll guide you through it.

## Step 8: Run the demo on mainnet

On your live site:

1. **Demo vault (Deployer account):** go to New vault, name it "Demo", lock **0.5 USDC**, choose a **2 minute** window, and set the heir to your **Heirloom Heir** address at 100%. Approve. Check the popup sends 0.5 USDC **to the Heirloom contract address** from step 5.
2. **Real vault (Deployer account):** name it "Family vault", lock **2 USDC**, choose **1 year**, with your Heir address as heir.
3. Wait 2 minutes. Switch the wallet to **Heirloom Heir**, reload, open **Left to me**, and click **Claim** on "Demo". Check the popup sends **0 USDC** to the Heirloom contract, so you only pay gas.
4. Click the explorer link in the confirmation and **save that claim transaction link**. It's your proof.

## Step 9: Final touches and submit

1. Edit `README.md` on GitHub and replace `<your-github-username>` and `<contract address>`.
2. Fill in `SUBMISSION.md` and submit on the official Arc Microgrants page. Type the address yourself and don't use a link from a DM.
3. For the payout address, use a **fresh** wallet address (it can be your Heir account), not the hacked one.

## If something goes wrong

- **The transaction doesn't appear:** your wallet must be on Arc (5042) and hold USDC. Arc ignores transactions priced under 20 gwei, and the app already handles this.
- **The site shows a 404:** wait a couple of minutes and check that the Pages folder is `/docs`.
- **"Isn't linked to a contract yet":** step 6 isn't done, or the site hasn't refreshed.
- **Anything asks for your seed phrase:** stop. It's a scam.
