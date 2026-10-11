// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Heirloom} from "../src/Heirloom.sol";

/// Heir contract that tries to re-enter claim() and withdraw() when paid.
contract ReentrantHeir {
    Heirloom public h;
    uint256 public id;
    bool public reentryBlocked;

    constructor(Heirloom _h) {
        h = _h;
    }

    function setId(uint256 _id) external {
        id = _id;
    }

    function claim() external {
        h.claim(id);
    }

    receive() external payable {
        try h.claim(id) {
            reentryBlocked = false;
        } catch {
            reentryBlocked = true;
        }
    }
}

/// Owner contract that tries to re-enter withdraw() when paid.
contract ReentrantOwner {
    Heirloom public h;
    uint256 public id;
    bool public reentryBlocked;

    constructor(Heirloom _h) {
        h = _h;
    }

    function create(address heir) external payable {
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = heir;
        b[0] = 10_000;
        id = h.createVault{value: msg.value}("o", a, b, 1 days);
    }

    function withdraw(uint256 amount) external {
        h.withdraw(id, amount);
    }

    receive() external payable {
        try h.withdraw(id, 1) {
            reentryBlocked = false;
        } catch {
            reentryBlocked = true;
        }
    }
}

contract HeirloomAttackTest is Test {
    Heirloom h;
    address owner = makeAddr("owner");
    address bob = makeAddr("bob");

    function setUp() public {
        h = new Heirloom();
        vm.deal(owner, 1_000 ether);
    }

    function test_ReentrantClaimCannotDoubleDip() public {
        ReentrantHeir evil = new ReentrantHeir(h);
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = address(evil);
        a[1] = bob;
        b[0] = 5_000;
        b[1] = 5_000;
        vm.prank(owner);
        uint256 id = h.createVault{value: 10 ether}("x", a, b, 1 days);
        evil.setId(id);
        vm.warp(block.timestamp + 1 days + 1);

        evil.claim();
        assertTrue(evil.reentryBlocked());
        assertEq(address(evil).balance, 5 ether); // exactly one share

        vm.prank(bob);
        h.claim(id);
        assertEq(bob.balance, 5 ether);
        assertEq(address(h).balance, 0);
    }

    function test_ReentrantWithdrawBlocked() public {
        ReentrantOwner evil = new ReentrantOwner(h);
        vm.deal(address(evil), 0);
        vm.prank(owner);
        evil.create{value: 10 ether}(bob);
        evil.withdraw(4 ether);
        assertTrue(evil.reentryBlocked());
        assertEq(address(evil).balance, 4 ether);
        assertEq(address(h).balance, 6 ether);
    }

    function test_StrangersCannotTouchOthersVaults() public {
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = bob;
        b[0] = 10_000;
        vm.prank(owner);
        uint256 id = h.createVault{value: 10 ether}("x", a, b, 1 days);

        address eve = makeAddr("eve");
        vm.deal(eve, 1 ether);
        vm.startPrank(eve);
        vm.expectRevert(Heirloom.NotOwner.selector);
        h.setHeirs(id, a, b);
        vm.expectRevert(Heirloom.NotOwner.selector);
        h.setInterval(id, 1 minutes);
        vm.expectRevert(Heirloom.NotOwner.selector);
        h.deposit{value: 1 ether}(id);
        vm.stopPrank();
    }

    function test_ForcedFundsDoNotBreakAccounting() public {
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = bob;
        b[0] = 10_000;
        vm.prank(owner);
        uint256 id = h.createVault{value: 10 ether}("x", a, b, 1 days);
        vm.deal(address(h), address(h).balance + 3 ether); // simulate forced send
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(bob);
        h.claim(id);
        assertEq(bob.balance, 10 ether); // gets tracked balance, not stray funds
    }

    /// Books always balance: contract holds at least the sum of vault balances.
    function testFuzz_BooksBalance(uint96 d1, uint96 d2, uint96 w, bool expire) public {
        vm.deal(owner, uint256(d1) + uint256(d2));
        address[] memory a = new address[](1);
        uint16[] memory b = new uint16[](1);
        a[0] = bob;
        b[0] = 10_000;
        vm.startPrank(owner);
        uint256 id1 = h.createVault{value: d1}("a", a, b, 1 days);
        uint256 id2 = h.createVault{value: d2}("b", a, b, 2 days);
        if (w > 0 && w <= d1) h.withdraw(id1, w);
        vm.stopPrank();
        if (expire) {
            vm.warp(block.timestamp + 1 days + 1);
            vm.prank(bob);
            h.claim(id1);
        }
        (Heirloom.Vault memory v1,,,) = h.getVault(id1);
        (Heirloom.Vault memory v2,,,) = h.getVault(id2);
        assertEq(address(h).balance, v1.balance + v2.balance);
    }
}
