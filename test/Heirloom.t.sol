// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Heirloom} from "../src/Heirloom.sol";

contract Rejecter {
    receive() external payable {
        revert();
    }
}

contract HeirloomTest is Test {
    Heirloom h;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address eve = makeAddr("eve");
    uint64 constant DAY = 1 days;

    function setUp() public {
        h = new Heirloom();
        vm.deal(owner, 1_000 ether);
    }

    function _two() internal view returns (address[] memory a, uint16[] memory b) {
        a = new address[](2);
        b = new uint16[](2);
        a[0] = alice;
        a[1] = bob;
        b[0] = 7_000;
        b[1] = 3_000;
    }

    function _create(uint256 amount) internal returns (uint256 id) {
        (address[] memory a, uint16[] memory b) = _two();
        vm.prank(owner);
        id = h.createVault{value: amount}("Family", a, b, 30 * DAY);
    }

    function test_CreateAndRead() public {
        uint256 id = _create(100 ether);
        (Heirloom.Vault memory v, Heirloom.Heir[] memory hs, uint64 deadline, bool expired) = h.getVault(id);
        assertEq(v.owner, owner);
        assertEq(v.balance, 100 ether);
        assertEq(hs.length, 2);
        assertEq(deadline, block.timestamp + 30 * DAY);
        assertFalse(expired);
        assertEq(h.vaultsOf(owner)[0], id);
        assertEq(h.vaultsAsHeir(bob)[0], id);
        assertEq(address(h).balance, 100 ether);
    }

    function test_HeirCannotClaimWhileAlive() public {
        uint256 id = _create(100 ether);
        vm.warp(block.timestamp + 30 * DAY); // exactly at deadline: still alive
        vm.prank(alice);
        vm.expectRevert(Heirloom.StillAlive.selector);
        h.claim(id);
    }

    function test_FullInheritanceFlow() public {
        uint256 id = _create(100 ether);
        vm.warp(block.timestamp + 30 * DAY + 1);

        vm.prank(alice);
        h.claim(id);
        assertEq(alice.balance, 70 ether);

        // Owner can no longer act after release
        vm.prank(owner);
        vm.expectRevert(Heirloom.AlreadyReleased.selector);
        h.checkIn(id);
        vm.prank(owner);
        vm.expectRevert(Heirloom.AlreadyReleased.selector);
        h.withdraw(id, 1);

        vm.prank(bob);
        h.claim(id);
        assertEq(bob.balance, 30 ether);
        assertEq(address(h).balance, 0);

        vm.prank(bob);
        vm.expectRevert(Heirloom.AlreadyClaimed.selector);
        h.claim(id);
    }

    function test_CheckInResetsTimer() public {
        uint256 id = _create(10 ether);
        vm.warp(block.timestamp + 29 * DAY);
        vm.prank(owner);
        h.checkIn(id);
        vm.warp(block.timestamp + 29 * DAY);
        vm.prank(alice);
        vm.expectRevert(Heirloom.StillAlive.selector);
        h.claim(id);
    }

    function test_FalseAlarmRevive() public {
        uint256 id = _create(10 ether);
        vm.warp(block.timestamp + 31 * DAY); // expired, nobody claimed
        vm.prank(owner);
        h.checkIn(id);
        (,,, bool expired) = h.getVault(id);
        assertFalse(expired);
    }

    function test_OnlyOwner() public {
        uint256 id = _create(10 ether);
        vm.startPrank(eve);
        vm.expectRevert(Heirloom.NotOwner.selector);
        h.checkIn(id);
        vm.expectRevert(Heirloom.NotOwner.selector);
        h.withdraw(id, 1 ether);
        vm.stopPrank();
    }

    function test_StrangerCannotClaim() public {
        uint256 id = _create(10 ether);
        vm.warp(block.timestamp + 31 * DAY);
        vm.prank(eve);
        vm.expectRevert(Heirloom.NotHeir.selector);
        h.claim(id);
    }

    function test_DepositWithdraw() public {
        uint256 id = _create(10 ether);
        vm.startPrank(owner);
        h.deposit{value: 5 ether}(id);
        h.withdraw(id, 12 ether);
        vm.expectRevert(Heirloom.Insufficient.selector);
        h.withdraw(id, 4 ether);
        vm.stopPrank();
        (Heirloom.Vault memory v,,,) = h.getVault(id);
        assertEq(v.balance, 3 ether);
        assertEq(owner.balance, 1_000 ether - 3 ether);
    }

    function test_BadHeirs() public {
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = alice;
        a[1] = alice; // duplicate
        b[0] = 5_000;
        b[1] = 5_000;
        vm.prank(owner);
        vm.expectRevert(Heirloom.BadHeirs.selector);
        h.createVault("x", a, b, DAY);

        a[1] = bob;
        b[1] = 4_000; // sums to 9000
        vm.prank(owner);
        vm.expectRevert(Heirloom.BadHeirs.selector);
        h.createVault("x", a, b, DAY);
    }

    function test_BadInterval() public {
        (address[] memory a, uint16[] memory b) = _two();
        vm.prank(owner);
        vm.expectRevert(Heirloom.BadInterval.selector);
        h.createVault("x", a, b, 30);
    }

    function test_OneBadHeirDoesNotBlockOthers() public {
        Rejecter r = new Rejecter();
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = address(r);
        a[1] = bob;
        b[0] = 5_000;
        b[1] = 5_000;
        vm.prank(owner);
        uint256 id = h.createVault{value: 10 ether}("x", a, b, DAY);
        vm.warp(block.timestamp + DAY + 1);

        vm.prank(address(r));
        vm.expectRevert(Heirloom.TransferFailed.selector);
        h.claim(id);

        vm.prank(bob);
        h.claim(id);
        assertEq(bob.balance, 5 ether);
    }

    function test_StrayTransferRejected() public {
        vm.prank(owner);
        (bool ok,) = address(h).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function testFuzz_SharesNeverExceedBalance(uint96 amount, uint16 split) public {
        split = uint16(bound(split, 1, 9_999));
        address[] memory a = new address[](2);
        uint16[] memory b = new uint16[](2);
        a[0] = alice;
        a[1] = bob;
        b[0] = split;
        b[1] = uint16(10_000 - split);
        vm.deal(owner, amount);
        vm.prank(owner);
        uint256 id = h.createVault{value: amount}("f", a, b, DAY);
        vm.warp(block.timestamp + DAY + 1);
        vm.prank(alice);
        h.claim(id);
        vm.prank(bob);
        h.claim(id);
        assertLe(alice.balance + bob.balance, amount);
        assertLe(amount - (alice.balance + bob.balance), 1);
    }
}
