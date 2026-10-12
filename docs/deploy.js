import { createWalletClient, createPublicClient, custom } from "./vendor/viem-2.57.4.js";
import { HEIRLOOM_ABI, HEIRLOOM_BYTECODE } from "./contract.js";
import { ARC as ARC_MAINNET, ARC_TESTNET, MIN_FEE, friendlyError } from "./chain.js";

let ARC = ARC_MAINNET;

const log = document.getElementById("log");

// Build all output with textContent so nothing from a wallet or RPC is ever parsed as HTML.
function say(text, opts = {}) {
  const p = document.createElement("p");
  if (opts.strong) {
    const s = document.createElement("strong");
    s.textContent = text;
    p.append(s);
  } else {
    p.textContent = text;
  }
  if (opts.link) {
    p.append(" ");
    const a = document.createElement("a");
    a.href = opts.link.href;
    a.textContent = opts.link.text;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    p.append(a);
  }
  log.append(p);
  return p;
}

async function switchToArc() {
  const hex = "0x" + ARC.id.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex,
        chainName: ARC.name,
        nativeCurrency: ARC.nativeCurrency,
        rpcUrls: ARC.rpcUrls.default.http,
        blockExplorerUrls: [ARC.blockExplorers.default.url],
      }],
    });
  }
  // Refuse to continue unless the wallet is really on Arc mainnet.
  const current = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
  if (current !== ARC.id) throw new Error(`Your wallet is on chain ${current}, not ${ARC.name} (${ARC.id}). Switch networks and try again.`);
}

document.getElementById("deploy").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  log.textContent = "";
  if (!window.ethereum) {
    say("No browser wallet found. Install MetaMask or Rabby from their official sites, then reload this page.");
    return;
  }
  ARC = document.querySelector('[name="net"]:checked')?.value === "testnet" ? ARC_TESTNET : ARC_MAINNET;
  btn.disabled = true;
  try {
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    await switchToArc();
    say(`Connected ${account} on ${ARC.name}.`);

    const wallet = createWalletClient({ account, chain: ARC, transport: custom(window.ethereum) });
    const reader = createPublicClient({ chain: ARC, transport: custom(window.ethereum) });

    let fees;
    try {
      const f = await reader.estimateFeesPerGas();
      const max = f.maxFeePerGas < MIN_FEE * 2n ? MIN_FEE * 2n : f.maxFeePerGas;
      fees = { maxFeePerGas: max, maxPriorityFeePerGas: (f.maxPriorityFeePerGas ?? 0n) > max ? max : (f.maxPriorityFeePerGas ?? 0n) };
    } catch {
      fees = { maxFeePerGas: MIN_FEE * 3n, maxPriorityFeePerGas: 1_000_000_000n };
    }

    say("Approve the contract deployment in your wallet. It should send 0 USDC and only charge gas.");
    const hash = await wallet.deployContract({ abi: HEIRLOOM_ABI, bytecode: HEIRLOOM_BYTECODE, account, chain: ARC, value: 0n, ...fees });
    const explorer = ARC.blockExplorers.default.url;
    say("Sent. Waiting for Arc to confirm…", { link: { href: `${explorer}/tx/${hash}`, text: "View transaction" } });

    const r = await reader.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error("The deployment reverted.");
    const addr = r.contractAddress;

    const box = document.createElement("div");
    box.className = "result";
    log.append(box);
    const line = (t) => { const p = document.createElement("p"); p.textContent = t; box.append(p); return p; };
    line(`Heirloom is live on ${ARC.name}. Your contract address:`);
    const code = document.createElement("code");
    code.textContent = addr;
    line("").append(code);
    const links = line("");
    const a1 = document.createElement("a");
    a1.href = `${explorer}/address/${addr}`; a1.textContent = "Open on explorer"; a1.target = "_blank"; a1.rel = "noopener noreferrer";
    const a2 = document.createElement("a");
    a2.href = ARC.testnet ? `./?net=testnet&contract=${addr}` : `./?contract=${addr}`; a2.textContent = "Open the app with this contract";
    links.append(a1, document.createTextNode("  ·  "), a2);
    line("Next: put this address in docs/config.js on GitHub (step 6 in the guide). A contract address is public and safe to share.").className = "hint";
  } catch (e) {
    say(friendlyError(e), { strong: true });
  } finally {
    btn.disabled = false;
  }
});
