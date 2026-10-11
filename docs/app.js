import { parseUnits, formatUnits, isAddress, getAddress } from "./vendor/viem-2.57.4.js";
import { HEIRLOOM_ABI } from "./contract.js";
import {
  CHAIN, NETWORK, CONTRACT, EXPLORER, publicClient, walletReader,
  connectWallet, disconnectWallet, walletFor, feeOverrides, shortAddr, friendlyError, hasWallet,
} from "./chain.js";

const $ = (s, el = document) => el.querySelector(s);
const panel = $("#panel");
const state = { account: null, wallet: null, reader: publicClient, tab: "mine", timer: null };

const INTERVALS = [
  [120, "2 minutes (demo)"],
  [86400, "1 day"],
  [7 * 86400, "1 week"],
  [30 * 86400, "30 days"],
  [90 * 86400, "90 days"],
  [180 * 86400, "6 months"],
  [365 * 86400, "1 year"],
];

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usdc = (v) => {
  const n = Number(formatUnits(v, 18));
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 6 : 2 });
};
const pct = (bps) => (Number(bps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

function duration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d >= 2) return `${d} days`;
  if (d === 1) return `1 day ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
function intervalName(sec) {
  const hit = INTERVALS.find(([v]) => v === Number(sec));
  return hit ? hit[1].replace(" (demo)", "") : duration(Number(sec));
}

let toastTimer;
function toast(html, isErr = false, ms = 6000) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.setAttribute("role", isErr ? "alert" : "status");
  t.innerHTML = html;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add("leaving");
    t.addEventListener("animationend", () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 400);
  }, ms);
}

// Small inline icons for the wallet menu (stroke icons, inherit color).
const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  copy: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  ext: icon('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  swap: icon('<path d="M7 7h12l-3-3"/><path d="M17 17H5l3 3"/>'),
  out: icon('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5"/><path d="M15 12H4"/>'),
  chev: '<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>',
};

const read = (functionName, args = []) =>
  state.reader.readContract({ address: CONTRACT, abi: HEIRLOOM_ABI, functionName, args });

async function write(functionName, args, value, doneMsg, btn) {
  if (!state.wallet) await connect(true);
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Confirm in wallet…"; }
  try {
    const fees = await feeOverrides();
    const hash = await state.wallet.writeContract({
      address: CONTRACT, abi: HEIRLOOM_ABI, functionName, args, value, account: state.account, chain: CHAIN, ...fees,
    });
    if (btn) btn.textContent = "Settling on Arc…";
    const r = await state.reader.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("The transaction reverted.");
    toast(`${esc(doneMsg)} <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener noreferrer">View on explorer</a>`);
    await refresh();
    return r;
  } catch (e) {
    toast(esc(friendlyError(e)), true);
    throw e;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

// ---------- wallet ----------
const connectBtn = $("#connect");

function paintWallet() {
  if (state.account) {
    connectBtn.className = "btn sm connected";
    connectBtn.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${shortAddr(state.account)}</span>${ICONS.chev}`;
    connectBtn.setAttribute("aria-haspopup", "menu");
    connectBtn.setAttribute("aria-expanded", String(menu.classList.contains("open")));
    connectBtn.setAttribute("aria-label", `Wallet ${state.account}. Open wallet menu`);
  } else {
    connectBtn.className = "btn sm";
    connectBtn.textContent = "Connect wallet";
    connectBtn.removeAttribute("aria-haspopup");
    connectBtn.removeAttribute("aria-expanded");
    connectBtn.removeAttribute("aria-label");
    closeMenu();
  }
}

function useAccount(account, wallet) {
  state.account = getAddress(account);
  state.wallet = wallet;
  state.reader = walletReader();
  paintWallet();
}

function clearAccount() {
  state.account = null;
  state.wallet = null;
  state.reader = publicReaderOk ? publicClient : state.reader;
  paintWallet();
}

let connecting = false;
async function connect(pick = true) {
  if (connecting) return;
  connecting = true;
  try {
    const { account, wallet } = await connectWallet({ pick });
    useAccount(account, wallet);
    await refresh();
  } catch (e) {
    toast(esc(friendlyError(e)), true);
    throw e;
  } finally {
    connecting = false;
  }
}

async function disconnect() {
  closeMenu();
  ignoreNextEmpty = true;
  await disconnectWallet();
  clearAccount();
  toast("Disconnected. Heirloom no longer sees your wallet.");
  await refresh();
}

// Wallet menu under the address chip.
const menu = document.createElement("div");
menu.className = "wallet-menu";
menu.id = "wallet-menu";
menu.setAttribute("role", "menu");
menu.innerHTML = `<div class="who"><small>Connected on ${esc(CHAIN.name)}</small><span id="wallet-menu-addr"></span></div>
  <button type="button" class="menu-item" role="menuitem" data-menu="copy">${ICONS.copy}<span>Copy address</span></button>
  <a class="menu-item" role="menuitem" id="menu-explorer" target="_blank" rel="noopener noreferrer">${ICONS.ext}<span>View on explorer</span></a>
  <button type="button" class="menu-item" role="menuitem" data-menu="switch">${ICONS.swap}<span>Switch account</span></button>
  <button type="button" class="menu-item danger" role="menuitem" data-menu="disconnect">${ICONS.out}<span>Disconnect</span></button>`;
$(".bar-inner").append(menu);

function openMenu() {
  $("#wallet-menu-addr").textContent = state.account;
  $("#menu-explorer").href = `${EXPLORER}/address/${state.account}`;
  menu.classList.add("open");
  connectBtn.setAttribute("aria-expanded", "true");
  menu.querySelector(".menu-item").focus({ preventScroll: true });
}
function closeMenu() {
  menu.classList.remove("open");
  if (state.account) connectBtn.setAttribute("aria-expanded", "false");
}

connectBtn.setAttribute("aria-controls", "wallet-menu");
connectBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!state.account) return connect(true).catch(() => {});
  menu.classList.contains("open") ? closeMenu() : openMenu();
});
menu.addEventListener("click", async (e) => {
  e.stopPropagation();
  const item = e.target.closest(".menu-item");
  if (!item) return;
  const act = item.dataset.menu;
  if (act === "copy") {
    try { await navigator.clipboard.writeText(state.account); toast("Address copied. Check the first and last characters when you paste it."); }
    catch { toast("Couldn't copy. Select the address in the menu and copy it by hand.", true); }
    closeMenu();
  }
  if (act === "switch") { closeMenu(); connect(true).catch(() => {}); }
  if (act === "disconnect") disconnect();
  if (!act) closeMenu(); // explorer link
});
document.addEventListener("click", () => closeMenu());
document.addEventListener("keydown", (e) => {
  if (!menu.classList.contains("open")) return;
  const items = [...menu.querySelectorAll(".menu-item")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "Escape") { closeMenu(); connectBtn.focus(); }
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});

// React to changes made inside the wallet, without reloading the page.
let ignoreNextEmpty = false;
function setNetworkPill(ok) {
  const pill = $("#net-pill");
  pill.classList.toggle("warn", !ok);
  $("#net-name").textContent = ok ? CHAIN.name : `Wrong network`;
  pill.title = ok ? `Connected to ${CHAIN.name}` : `Switch your wallet to ${CHAIN.name} (chain ${CHAIN.id})`;
}
if (hasWallet()) {
  window.ethereum.on?.("accountsChanged", async (accounts) => {
    if (!accounts || !accounts.length) {
      if (state.account && !ignoreNextEmpty) toast("Your wallet disconnected from Heirloom.");
      ignoreNextEmpty = false;
      clearAccount();
      return refresh();
    }
    if (same(accounts[0], state.account)) return;
    if (!state.account && !connecting) return; // not connected here; ignore
    useAccount(accounts[0], walletFor(accounts[0]));
    toast(`Switched to ${shortAddr(state.account)}.`);
    refresh();
  });
  window.ethereum.on?.("chainChanged", (hex) => {
    const ok = parseInt(hex, 16) === CHAIN.id;
    setNetworkPill(ok);
    if (!ok && state.account) toast(`Your wallet left ${CHAIN.name}. Switch back to use Heirloom.`, true);
    if (ok && state.account) refresh();
  });
}

// Reconnect quietly after a reload if this site is already approved (no popup).
async function restoreSession() {
  if (!hasWallet()) return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (!accounts || !accounts.length) return;
    const chain = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
    setNetworkPill(chain === CHAIN.id);
    if (chain !== CHAIN.id) return;
    const { account, wallet } = await connectWallet({ pick: false });
    useAccount(account, wallet);
  } catch {}
}

// ---------- tabs ----------
const tabs = $("nav.tabs");
const indicator = document.createElement("span");
indicator.className = "indicator";
indicator.setAttribute("aria-hidden", "true");
tabs.append(indicator);
function moveIndicator() {
  const b = tabs.querySelector('[aria-selected="true"]');
  if (!b) return;
  indicator.style.width = `${b.offsetWidth}px`;
  indicator.style.transform = `translateX(${b.offsetLeft}px)`;
}
function selectTab(name) {
  tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === name)));
  state.tab = name;
  moveIndicator();
  render();
}
tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));
addEventListener("resize", moveIndicator);
document.fonts?.ready.then(moveIndicator);

// ---------- views ----------
async function loadVault(id) {
  const [vault, heirs, deadline, expired] = await read("getVault", [BigInt(id)]);
  return { id: Number(id), vault, heirs, deadline: Number(deadline), expired };
}

function pulseSvg(v) {
  const now = Date.now() / 1000;
  const total = Number(v.vault.interval);
  // Trust the chain: if Arc says the window has passed, show it as overdue.
  const left = v.expired ? Math.min(v.deadline - now, 0) : Math.max(v.deadline - now, 1);
  const frac = v.vault.released ? 1 : Math.max(0, Math.min(1, left / total));
  const C = 2 * Math.PI * 52;
  const cls = v.vault.released ? "done" : left <= 0 ? "late" : "";
  const label = v.vault.released
    ? `<strong>Released</strong>to heirs`
    : left <= 0
      ? `<strong>Overdue</strong>${duration(-left)}`
      : `<strong>${duration(left)}</strong>until due`;
  return `<div class="pulse ${cls}" data-deadline="${v.deadline}" data-interval="${total}" data-released="${v.vault.released}" data-expired="${v.expired}">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="52" fill="none" stroke-width="8"/>
      <circle class="fill" cx="60" cy="60" r="52" fill="none" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/>
    </svg>
    <div class="label">${label}</div>
  </div>`;
}

function heirTable(v) {
  return `<table class="heirs"><tbody>${v.heirs.map((h) => {
    const share = v.vault.released ? (v.vault.releasedTotal * BigInt(h.bps)) / 10000n : (v.vault.balance * BigInt(h.bps)) / 10000n;
    return `<tr>
      <td class="addr"><a href="${EXPLORER}/address/${h.account}" target="_blank" rel="noopener noreferrer">${shortAddr(h.account)}</a>${same(h.account, state.account) ? '<span class="you">you</span>' : ""}</td>
      <td>${pct(h.bps)}</td>
      <td>${h.claimed ? "Claimed" : usdc(share) + " USDC"}</td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

function vaultHtml(v, role) {
  const name = v.vault.name || `Vault ${v.id}`;
  const late = v.expired && !v.vault.released;
  const me = v.heirs.find((h) => same(h.account, state.account));
  let status;
  if (v.vault.released) status = `<p class="state">Heirs are claiming. The owner can no longer change this vault.</p>`;
  else if (late) status = `<p class="state late">The owner missed their check-in. Heirs can claim now, and the owner can still check in until someone does.</p>`;
  else status = `<p class="state">Check-in window: every ${intervalName(v.vault.interval)}. Next check-in due ${new Date(v.deadline * 1000).toLocaleString()}.</p>`;

  let actions = "";
  if (role === "owner" && !v.vault.released) {
    actions = `<div class="actions">
      <button class="btn${late ? " seal" : ""}" data-act="checkIn" data-id="${v.id}">Check in</button>
      <button class="btn quiet" data-act="showDeposit" data-id="${v.id}">Add USDC</button>
      <button class="btn quiet" data-act="showWithdraw" data-id="${v.id}">Withdraw</button>
    </div><div class="inline-slot" id="slot-${v.id}"></div>`;
  } else if (role === "heir" && me && !me.claimed) {
    actions = v.expired
      ? `<div class="actions"><button class="btn" data-act="claim" data-id="${v.id}">Claim my ${pct(me.bps)}</button></div>`
      : `<p class="hint">You can claim your ${pct(me.bps)} once the owner misses a check-in.</p>`;
  } else if (role === "heir" && me?.claimed) {
    actions = `<p class="hint">You've claimed your share.</p>`;
  }

  return `<article class="vault">
    ${pulseSvg(v)}
    <div>
      <h3>${esc(name)}</h3>
      <p class="meta">Vault ${v.id}, owned by <a href="${EXPLORER}/address/${v.vault.owner}" target="_blank" rel="noopener noreferrer">${shortAddr(v.vault.owner)}</a></p>
      <p class="amount">${usdc(v.vault.balance)}<small>USDC</small></p>
      ${status}
      ${heirTable(v)}
      ${actions}
    </div>
  </article>`;
}

function skeleton(n = 1) {
  return Array.from({ length: n }, () => `<div class="skeleton" aria-hidden="true">
    <div class="ring shimmer"></div>
    <div class="lines"><div class="bar w60 shimmer"></div><div class="bar w40 shimmer"></div><div class="bar big shimmer"></div><div class="bar w80 shimmer"></div><div class="bar w60 shimmer"></div></div>
  </div>`).join("") + `<span class="visually-hidden">Loading…</span>`;
}

function needWallet(msg) {
  panel.innerHTML = `<div class="empty"><p>${msg}</p><button class="btn" id="cta-connect">Connect wallet</button></div>`;
  $("#cta-connect").addEventListener("click", () => connect().catch(() => {}));
}

function notDeployed() {
  panel.innerHTML = `<div class="empty"><p>This copy of Heirloom isn't linked to a contract yet. Deploy it from the <a href="deploy.html">deploy page</a>, then add the address to <code>config.js</code>.</p></div>`;
}

async function renderMine() {
  if (!state.account) return needWallet("Connect your wallet to see the vaults you own.");
  panel.innerHTML = skeleton(1);
  const ids = await read("vaultsOf", [state.account]);
  if (!ids.length) {
    panel.innerHTML = `<div class="empty"><p>You don't have a vault yet. Create one to put USDC aside for the people you choose.</p><button class="btn" id="go-new">Create a vault</button></div>`;
    $("#go-new").addEventListener("click", () => selectTab("new"));
    return;
  }
  const vaults = await Promise.all([...ids].reverse().map(loadVault));
  panel.innerHTML = vaults.map((v) => vaultHtml(v, "owner")).join("");
}

async function renderHeir() {
  if (!state.account) return needWallet("Connect your wallet to see vaults that name you as an heir.");
  panel.innerHTML = skeleton(1);
  const raw = await read("vaultsAsHeir", [state.account]);
  // Anyone can name any address as an heir, so cap how many we load (newest first)
  // to keep a spammed address from slowing the page down.
  const ids = [...new Set(raw.map(Number))].reverse().slice(0, 50);
  const vaults = (await Promise.all(ids.map(loadVault))).filter((v) => v.heirs.some((h) => same(h.account, state.account)));
  if (!vaults.length) {
    panel.innerHTML = `<div class="empty"><p>No vault names this wallet as an heir yet. When someone adds you, it shows up here.</p></div>`;
    return;
  }
  panel.innerHTML = `<p class="banner">Anyone can name you as an heir, so vault names here are written by their owners. Claiming only ever sends USDC to you, and Heirloom never asks for your seed phrase or sends you to another site.</p>` +
    vaults.map((v) => vaultHtml(v, "heir")).join("");
}

function heirRow(addr = "", share = "") {
  return `<div class="heir-row">
    <input name="heir" placeholder="0x… heir address" value="${esc(addr)}" aria-label="Heir address" autocomplete="off" spellcheck="false">
    <input name="share" type="number" min="0.01" max="100" step="0.01" placeholder="%" value="${esc(share)}" aria-label="Share in percent">
    <button type="button" data-act="removeHeir" aria-label="Remove heir">×</button>
  </div>`;
}

function renderNew() {
  panel.innerHTML = `<form class="create" id="create" novalidate>
    <label class="field">Vault name <span class="hint">Only a label, for example "For Maya and Sam".</span>
      <input name="name" maxlength="60" placeholder="Family vault">
    </label>
    <label class="field">USDC to lock now <span class="hint">You can add more or withdraw later. Keep a little USDC in your wallet for gas.</span>
      <input name="amount" type="number" min="0" step="0.01" placeholder="25.00">
    </label>
    <label class="field">Check-in window <span class="hint">If you don't check in within this time, your heirs can claim.</span>
      <select name="interval">${INTERVALS.map(([v, l]) => `<option value="${v}" ${v === 30 * 86400 ? "selected" : ""}>${l}</option>`).join("")}</select>
    </label>
    <fieldset>
      <legend>Heirs and shares</legend>
      <div id="heir-rows">${heirRow("", "100")}</div>
      <div class="actions"><button type="button" class="btn quiet" data-act="addHeir">Add heir</button><span class="sum" id="sum">Total: 100%</span></div>
    </fieldset>
    <div><button class="btn" type="submit" id="create-btn">Create vault</button></div>
  </form>`;
  const form = $("#create");
  const updateSum = () => {
    const total = [...form.querySelectorAll('[name="share"]')].reduce((a, i) => a + Math.round(Number(i.value || 0) * 100), 0);
    const s = $("#sum");
    s.textContent = `Total: ${(total / 100).toLocaleString()}%` + (total === 10000 ? "" : " (needs to be 100%)");
    s.classList.toggle("bad", total !== 10000);
  };
  form.addEventListener("input", updateSum);
  form.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    if (act === "addHeir") {
      const rows = $("#heir-rows");
      if (rows.children.length >= 10) return toast("A vault can have up to 10 heirs.", true);
      rows.insertAdjacentHTML("beforeend", heirRow());
      rows.lastElementChild.querySelector("input").focus();
    }
    if (act === "removeHeir") {
      if ($("#heir-rows").children.length > 1) e.target.closest(".heir-row").remove();
      updateSum();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const heirs = fd.getAll("heir").map((s) => s.trim());
    const bps = fd.getAll("share").map((s) => Math.round(Number(s || 0) * 100));
    const bad = heirs.findIndex((a) => !isAddress(a));
    if (bad >= 0) return toast(`Heir ${bad + 1} needs a valid 0x address.`, true);
    if (new Set(heirs.map((a) => a.toLowerCase())).size !== heirs.length) return toast("Each heir can only appear once.", true);
    if (bps.some((b) => b <= 0)) return toast("Every heir needs a share above 0%.", true);
    if (bps.reduce((a, b) => a + b, 0) !== 10000) return toast("Shares need to add up to exactly 100%.", true);
    let value = 0n;
    try { value = parseUnits(String(fd.get("amount") || "0"), 18); } catch { return toast("Enter the amount as a number, like 25 or 25.50.", true); }
    try {
      await write("createVault", [String(fd.get("name") || "").trim(), heirs.map((a) => getAddress(a)), bps, BigInt(fd.get("interval"))], value, "Vault created.", $("#create-btn"));
      selectTab("mine");
    } catch {}
  });
}

function renderLookup(prefill = "") {
  panel.innerHTML = `<div>
    <p class="hint lookup-hint">Every vault is public on Arc. Enter a vault number to see its balance, heirs and countdown. No wallet needed.</p>
    <form class="lookup" id="lookup"><input name="id" type="number" min="0" placeholder="Vault number" value="${esc(prefill)}" aria-label="Vault number"><button class="btn">Look up</button></form>
    <div id="lookup-out" class="lookup-out"></div>
  </div>`;
  const run = async (id) => {
    const out = $("#lookup-out");
    out.innerHTML = skeleton(1);
    try {
      const v = await loadVault(id);
      const role = same(v.vault.owner, state.account) ? "owner" : v.heirs.some((h) => same(h.account, state.account)) ? "heir" : "viewer";
      out.innerHTML = vaultHtml(v, role);
      history.replaceState(null, "", `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), vault: id })}`);
    } catch (e) {
      out.innerHTML = `<p class="state late">${/NoSuchVault/.test(String(e)) ? `There's no vault ${esc(id)} yet.` : esc(friendlyError(e))}</p>`;
    }
  };
  $("#lookup").addEventListener("submit", (e) => { e.preventDefault(); const id = new FormData(e.target).get("id"); if (id !== "") run(id); });
  if (prefill !== "") run(prefill);
}

// ---------- vault actions (delegated) ----------
panel.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn || btn.closest("form.create")) return;
  const id = BigInt(btn.dataset.id ?? 0);
  const act = btn.dataset.act;
  try {
    if (act === "checkIn") await write("checkIn", [id], 0n, "Checked in. Your timer has restarted.", btn);
    if (act === "claim") await write("claim", [id], 0n, "Share claimed. The USDC is in your wallet.", btn);
    if (act === "showDeposit" || act === "showWithdraw") {
      const dep = act === "showDeposit";
      const slot = $(`#slot-${id}`);
      slot.innerHTML = `<form class="inline-amount"><input type="number" min="0" step="0.01" placeholder="USDC" aria-label="Amount in USDC" required><button class="btn">${dep ? "Add USDC" : "Withdraw"}</button></form>`;
      const f = slot.querySelector("form");
      f.querySelector("input").focus();
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        let amt;
        try { amt = parseUnits(f.querySelector("input").value || "0", 18); } catch { return toast("Enter the amount as a number.", true); }
        if (amt <= 0n) return toast("Enter an amount greater than zero.", true);
        const b = f.querySelector("button");
        try {
          if (dep) await write("deposit", [id], amt, "USDC added. This also counted as a check-in.", b);
          else await write("withdraw", [id, amt], 0n, "Withdrawn to your wallet. This also counted as a check-in.", b);
        } catch {}
      });
    }
  } catch {}
});

// ---------- live countdown ----------
function tick() {
  const C = 2 * Math.PI * 52;
  document.querySelectorAll(".pulse").forEach((p) => {
    if (p.dataset.released === "true") return;
    let left = Number(p.dataset.deadline) - Date.now() / 1000;
    if (p.dataset.expired === "true") left = Math.min(left, 0);
    const frac = Math.max(0, Math.min(1, left / Number(p.dataset.interval)));
    p.querySelector(".fill").setAttribute("stroke-dashoffset", C * (1 - frac));
    p.classList.toggle("late", left <= 0);
    p.querySelector(".label").innerHTML = left <= 0 ? `<strong>Overdue</strong>${duration(-left)}` : `<strong>${duration(left)}</strong>until due`;
  });
}
setInterval(tick, 1000);

// ---------- stats + boot ----------
// Prefer Arc's public RPC for reads; if the browser can't reach it, fall back
// to the connected wallet's Arc connection.
let publicReaderOk = true;
async function checkPublicReader() {
  try {
    await Promise.race([publicClient.getChainId(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 6000))]);
    publicReaderOk = true;
  } catch {
    publicReaderOk = false;
  }
}

async function stats() {
  const v = $("#stat-vaults"), l = $("#stat-locked");
  if (v.textContent === "–") { v.classList.add("loading", "shimmer"); l.classList.add("loading", "shimmer"); }
  try {
    const [count, bal] = await Promise.all([read("vaultCount"), state.reader.getBalance({ address: CONTRACT })]);
    v.textContent = Number(count).toLocaleString();
    l.textContent = usdc(bal);
  } catch {
    v.textContent = "–";
    l.textContent = "–";
  } finally {
    v.classList.remove("loading", "shimmer"); l.classList.remove("loading", "shimmer");
  }
}

let renderSeq = 0;
async function render() {
  if (!CONTRACT) return notDeployed();
  const seq = ++renderSeq;
  panel.classList.remove("enter");
  try {
    if (state.tab === "mine") await renderMine();
    if (state.tab === "heir") await renderHeir();
    if (state.tab === "new") state.account ? renderNew() : needWallet("Connect your wallet to create a vault.");
    if (state.tab === "lookup") renderLookup(new URLSearchParams(location.search).get("vault") ?? "");
  } catch (e) {
    if (seq !== renderSeq) return;
    panel.innerHTML = `<div class="empty"><p>Couldn't reach Arc right now.</p><p class="hint">${state.account ? "Check that your wallet is on Arc, then try again." : "Connect your wallet and Heirloom will read through your wallet's Arc connection."}</p><button class="btn quiet" id="retry">Try again</button></div>`;
    $("#retry").addEventListener("click", () => refresh());
  }
  if (seq === renderSeq) { void panel.offsetWidth; panel.classList.add("enter"); }
}

async function refresh() {
  await Promise.all([render(), stats()]);
}

(async function boot() {
  $("#stat-network").textContent = CHAIN.name;
  if (CONTRACT) {
    $("#stat-contract").innerHTML = `<a href="${EXPLORER}/address/${CONTRACT}" target="_blank" rel="noopener noreferrer">contract ${shortAddr(CONTRACT)}</a>`;
    $("#footer-links").innerHTML = ` <a href="${EXPLORER}/address/${CONTRACT}" target="_blank" rel="noopener noreferrer">Contract on Arc explorer</a>.`;
  }
  if (NETWORK === "testnet") {
    $("#network-banner").innerHTML = `<p class="banner">You're on Arc Testnet. Get free test USDC from <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">faucet.circle.com</a>.</p>`;
  }
  const startTab = new URLSearchParams(location.search).has("vault") ? "lookup" : "mine";
  tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === startTab)));
  state.tab = startTab;
  moveIndicator();
  paintWallet();
  panel.innerHTML = skeleton(1);
  await Promise.all([checkPublicReader(), restoreSession()]);
  refresh();
})();
