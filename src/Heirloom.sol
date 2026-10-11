// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Heirloom — a USDC inheritance vault (dead man's switch) on Arc
/// @notice An owner locks native USDC in a vault, names heirs with percentage
///         shares, and checks in periodically. If the owner misses the
///         check-in window, each heir can claim their share.
/// @dev Arc specifics this contract relies on:
///      - USDC is Arc's native gas token, so vaults hold native value
///        (msg.value, 18 decimals). No ERC-20 approvals are needed.
///      - Native transfers can revert on Arc (blocklist, zero address), so
///        payouts are pull-based: one heir that cannot receive never blocks
///        the others.
///      - Arc has deterministic sub-second finality, so a check-in or claim
///        is final as soon as it is included.
contract Heirloom {
    // ------------------------------------------------------------------
    // Types and storage
    // ------------------------------------------------------------------

    uint256 public constant MAX_HEIRS = 10;
    uint256 public constant BPS = 10_000;
    uint64 public constant MIN_INTERVAL = 1 minutes; // short for live demos
    uint64 public constant MAX_INTERVAL = 3650 days;

    struct Vault {
        address owner;
        uint64 interval; // seconds allowed between check-ins
        uint64 lastCheckIn; // timestamp of last proof of life
        bool released; // true once the first heir has claimed
        uint256 balance; // USDC currently held (18 decimals)
        uint256 releasedTotal; // snapshot of balance at release
        string name; // optional label, e.g. "Family vault"
    }

    struct Heir {
        address account;
        uint16 bps; // share in basis points (10000 = 100%)
        bool claimed;
    }

    Vault[] private _vaults;
    mapping(uint256 => Heir[]) private _heirs;
    mapping(address => uint256[]) private _ownerVaults;
    mapping(address => uint256[]) private _heirVaults; // append-only index

    uint256 private _lock = 1;

    // ------------------------------------------------------------------
    // Events and errors
    // ------------------------------------------------------------------

    event VaultCreated(uint256 indexed id, address indexed owner, uint64 interval, string name);
    event Deposited(uint256 indexed id, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed id, uint256 amount);
    event CheckedIn(uint256 indexed id, uint64 at, uint64 deadline);
    event IntervalChanged(uint256 indexed id, uint64 interval);
    event HeirsSet(uint256 indexed id, address[] heirs, uint16[] bps);
    event Released(uint256 indexed id, uint256 total);
    event Claimed(uint256 indexed id, address indexed heir, uint256 amount);

    error NotOwner();
    error NoSuchVault();
    error BadInterval();
    error BadHeirs();
    error StillAlive();
    error AlreadyExpired();
    error AlreadyReleased();
    error NotHeir();
    error AlreadyClaimed();
    error Insufficient();
    error ZeroAmount();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner(uint256 id) {
        if (id >= _vaults.length) revert NoSuchVault();
        if (msg.sender != _vaults[id].owner) revert NotOwner();
        _;
    }

    // ------------------------------------------------------------------
    // Owner actions
    // ------------------------------------------------------------------

    /// @notice Create a vault. Any USDC sent with the call is deposited.
    function createVault(
        string calldata name,
        address[] calldata heirs,
        uint16[] calldata bps,
        uint64 interval
    ) external payable returns (uint256 id) {
        if (interval < MIN_INTERVAL || interval > MAX_INTERVAL) revert BadInterval();
        if (bytes(name).length > 64) revert BadHeirs();

        id = _vaults.length;
        _vaults.push(
            Vault({
                owner: msg.sender,
                interval: interval,
                lastCheckIn: uint64(block.timestamp),
                released: false,
                balance: msg.value,
                releasedTotal: 0,
                name: name
            })
        );
        _ownerVaults[msg.sender].push(id);
        _setHeirs(id, heirs, bps);

        emit VaultCreated(id, msg.sender, interval, name);
        if (msg.value > 0) emit Deposited(id, msg.sender, msg.value);
        emit CheckedIn(id, uint64(block.timestamp), uint64(block.timestamp) + interval);
    }

    /// @notice Proof of life. Resets the countdown. Also works after the
    ///         deadline as long as no heir has claimed yet (false alarm).
    function checkIn(uint256 id) public onlyOwner(id) {
        Vault storage v = _vaults[id];
        if (v.released) revert AlreadyReleased();
        v.lastCheckIn = uint64(block.timestamp);
        emit CheckedIn(id, v.lastCheckIn, v.lastCheckIn + v.interval);
    }

    /// @notice Add USDC. Only the owner can deposit, and it counts as a check-in.
    function deposit(uint256 id) external payable onlyOwner(id) {
        if (msg.value == 0) revert ZeroAmount();
        Vault storage v = _vaults[id];
        if (v.released) revert AlreadyReleased();
        v.balance += msg.value;
        emit Deposited(id, msg.sender, msg.value);
        checkIn(id);
    }

    /// @notice Take USDC back out. Only while the vault has not been released.
    function withdraw(uint256 id, uint256 amount) external onlyOwner(id) nonReentrant {
        Vault storage v = _vaults[id];
        if (v.released) revert AlreadyReleased();
        if (amount == 0) revert ZeroAmount();
        if (amount > v.balance) revert Insufficient();
        v.balance -= amount;
        v.lastCheckIn = uint64(block.timestamp);
        emit Withdrawn(id, amount);
        emit CheckedIn(id, v.lastCheckIn, v.lastCheckIn + v.interval);
        _send(msg.sender, amount);
    }

    function setInterval(uint256 id, uint64 interval) external onlyOwner(id) {
        if (interval < MIN_INTERVAL || interval > MAX_INTERVAL) revert BadInterval();
        Vault storage v = _vaults[id];
        if (v.released) revert AlreadyReleased();
        v.interval = interval;
        emit IntervalChanged(id, interval);
        checkIn(id);
    }

    function setHeirs(uint256 id, address[] calldata heirs, uint16[] calldata bps) external onlyOwner(id) {
        if (_vaults[id].released) revert AlreadyReleased();
        delete _heirs[id];
        _setHeirs(id, heirs, bps);
        checkIn(id);
    }

    // ------------------------------------------------------------------
    // Heir actions
    // ------------------------------------------------------------------

    /// @notice Claim your share after the owner missed the check-in window.
    ///         The first claim freezes the vault and snapshots the balance.
    function claim(uint256 id) external nonReentrant {
        if (id >= _vaults.length) revert NoSuchVault();
        Vault storage v = _vaults[id];
        if (!_expired(v)) revert StillAlive();

        Heir[] storage hs = _heirs[id];
        uint256 n = hs.length;
        uint256 i;
        for (; i < n; ++i) {
            if (hs[i].account == msg.sender) break;
        }
        if (i == n) revert NotHeir();
        if (hs[i].claimed) revert AlreadyClaimed();

        if (!v.released) {
            v.released = true;
            v.releasedTotal = v.balance;
            emit Released(id, v.balance);
        }

        uint256 amount = (v.releasedTotal * hs[i].bps) / BPS;
        hs[i].claimed = true;
        v.balance -= amount;
        emit Claimed(id, msg.sender, amount);
        if (amount > 0) _send(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function getVault(uint256 id)
        external
        view
        returns (Vault memory vault, Heir[] memory heirs, uint64 deadline, bool expired)
    {
        if (id >= _vaults.length) revert NoSuchVault();
        vault = _vaults[id];
        heirs = _heirs[id];
        deadline = vault.lastCheckIn + vault.interval;
        expired = _expired(_vaults[id]);
    }

    function vaultsOf(address owner) external view returns (uint256[] memory) {
        return _ownerVaults[owner];
    }

    /// @notice Vaults where `heir` was ever named. Check getVault for the
    ///         current heir list, since owners can change heirs.
    function vaultsAsHeir(address heir) external view returns (uint256[] memory) {
        return _heirVaults[heir];
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _expired(Vault storage v) private view returns (bool) {
        return block.timestamp > uint256(v.lastCheckIn) + v.interval;
    }

    function _setHeirs(uint256 id, address[] calldata heirs, uint16[] calldata bps) private {
        uint256 n = heirs.length;
        if (n == 0 || n > MAX_HEIRS || n != bps.length) revert BadHeirs();
        uint256 total = 0;
        for (uint256 i; i < n; ++i) {
            address a = heirs[i];
            if (a == address(0) || bps[i] == 0) revert BadHeirs();
            for (uint256 j; j < i; ++j) {
                if (heirs[j] == a) revert BadHeirs();
            }
            total += bps[i];
            _heirs[id].push(Heir({account: a, bps: bps[i], claimed: false}));
            _heirVaults[a].push(id);
        }
        if (total != BPS) revert BadHeirs();
        emit HeirsSet(id, heirs, bps);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Reject stray transfers so every USDC in the contract is accounted for.
    receive() external payable {
        revert();
    }
}
