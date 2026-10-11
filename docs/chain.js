// Shared Arc network + wallet helpers.
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  defineChain,
} from "./vendor/viem-2.57.4.js";
import { ADDRESSES } from "./config.js";

export const ARC = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

const params = new URLSearchParams(location.search);
export const NETWORK = params.get("net") === "testnet" ? "testnet" : "mainnet";
export const CHAIN = NETWORK === "testnet" ? ARC_TESTNET : ARC;
export const EXPLORER = CHAIN.blockExplorers.default.url;

// Contract address: ?contract=0x… overrides config.js
export const CONTRACT = (params.get("contract") || ADDRESSES[NETWORK] || "").trim();

// Arc drops transactions with maxFeePerGas below 20 gwei.
export const MIN_FEE = 20_000_000_000n;

export const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

// After a wallet connects, read through it too (avoids any RPC CORS limits).
export function walletReader() {
  return createPublicClient({ chain: CHAIN, transport: custom(window.ethereum) });
}

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function ensureChain() {
  const hex = "0x" + CHAIN.id.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err) {
    if (err && (err.code === 4902 || err.code === -32603)) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: CHAIN.rpcUrls.default.http,
          blockExplorerUrls: [EXPLORER],
        }],
      });
    } else {
      throw err;
    }
  }
}

// pick=true asks the wallet to show its account chooser, even if this site
// was approved before, so the person always sees which account they connect.
export async function connectWallet({ pick = false } = {}) {
  if (!hasWallet()) throw new Error("No browser wallet found. Install MetaMask or Rabby, then reload this page.");
  if (pick) {
    try {
      await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch (err) {
      if (err && err.code === 4001) throw err; // cancelled in the wallet
      // Wallet doesn't support the chooser; fall through to the normal request.
    }
  }
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureChain();
  const current = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
  if (current !== CHAIN.id) throw new Error(`Your wallet is on chain ${current}, not ${CHAIN.name} (${CHAIN.id}). Switch networks and try again.`);
  const wallet = createWalletClient({ account, chain: CHAIN, transport: custom(window.ethereum) });
  return { account, wallet };
}

// Ask the wallet to forget this site. Not every wallet supports it; the app
// forgets the account either way.
export async function disconnectWallet() {
  if (!hasWallet()) return;
  try {
    await window.ethereum.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // Older wallets: the person can remove the site from the wallet's own settings.
  }
}

// Fee overrides that respect Arc's 20 gwei floor.
export async function feeOverrides() {
  try {
    const f = await publicClient.estimateFeesPerGas();
    const max = f.maxFeePerGas < MIN_FEE * 2n ? MIN_FEE * 2n : f.maxFeePerGas;
    const tip = f.maxPriorityFeePerGas ?? 0n;
    return { maxFeePerGas: max, maxPriorityFeePerGas: tip > max ? max : tip };
  } catch {
    return { maxFeePerGas: MIN_FEE * 3n, maxPriorityFeePerGas: 1_000_000_000n };
  }
}

export function shortAddr(a) {
  return a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
}

export function friendlyError(err) {
  const m = (err && (err.shortMessage || err.message)) || String(err);
  if (/User rejected|denied|4001/i.test(m)) return "You cancelled the request in your wallet.";
  if (/insufficient funds/i.test(m)) return "Not enough USDC in your wallet to cover this amount plus gas.";
  const known = {
    StillAlive: "The owner is still within their check-in window, so heirs can't claim yet.",
    NotHeir: "This wallet is not an heir of this vault.",
    AlreadyClaimed: "This wallet has already claimed its share.",
    AlreadyReleased: "Heirs have started claiming, so the owner can no longer change this vault.",
    NotOwner: "Only the vault owner can do that.",
    BadHeirs: "Check the heirs: each needs a valid address, no duplicates, and shares must add up to exactly 100%.",
    BadInterval: "Pick a check-in window between 1 minute and 10 years.",
    Insufficient: "The vault doesn't hold that much USDC.",
    ZeroAmount: "Enter an amount greater than zero.",
    TransferFailed: "The payout couldn't be delivered to this address.",
  };
  for (const k in known) if (m.includes(k)) return known[k];
  return m.split("\n")[0];
}
