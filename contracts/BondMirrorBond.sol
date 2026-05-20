// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title  BondMirrorBond v2
/// @notice Leaders stake a USDC bond to back their copy-trading strategy.
///         Followers pay a subscription fee upfront and share performance fees on gains.
///         The risk agent can slash the bond (distributed to followers) on mandate violations.
///         Leaders collect accumulated performance fees via collectLeaderFees().
contract BondMirrorBond {

    // ── Enums / structs ───────────────────────────────────────────────────────

    enum StrategyStatus { Active, Paused, Slashed, Withdrawn }

    struct SlashRule {
        bytes32 condition;
        uint16  slashBps;
    }

    struct Strategy {
        address leader;
        uint256 bond;
        uint256 cooldownEndsAt;
        string  mandateURI;
        string  benchmark;
        StrategyStatus status;
        uint256 followerCount;
        uint256 totalFollowerWeight;
        uint256 totalClaimable;
        // ── v2: leader earnings ───────────────────────────────────────────────
        uint16  performanceFeeBps;    // % of follower gains paid to leader (max 3000 = 30%)
        uint256 subscriptionFeeUsdc;  // flat USDC charged per subscriber (can be 0)
        uint256 totalFeesEarned;      // lifetime fees accumulated by leader
    }

    struct Attestation {
        uint256  strategyId;
        bytes32  condition;
        string   evidenceURI;
        uint16   slashBps;
        address  agent;
        uint256  createdAt;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public riskAgent;
    uint256 public nextStrategyId = 1;

    mapping(uint256 => Strategy)                         public strategies;
    mapping(uint256 => SlashRule[])                      public slashRules;
    mapping(uint256 => Attestation[])                    public attestations;
    mapping(uint256 => mapping(address => uint256))      public followerWeight;
    mapping(uint256 => mapping(address => uint256))      public claimable;
    /// @dev Performance fees accumulated in the contract, withdrawable by the leader.
    mapping(uint256 => uint256)                          public leaderFeeBalance;

    // ── Events ────────────────────────────────────────────────────────────────

    event StrategyCreated(uint256 indexed strategyId, address indexed leader, string mandateURI, uint16 performanceFeeBps, uint256 subscriptionFeeUsdc);
    event BondStaked(uint256 indexed strategyId, uint256 amount);
    event FollowerSubscribed(uint256 indexed strategyId, address indexed follower, uint256 weight, uint256 subscriptionFeePaid);
    event SubscriptionFeePaid(uint256 indexed strategyId, address indexed follower, uint256 amount);
    event PerformanceFeeSettled(uint256 indexed strategyId, address indexed follower, uint256 feeAmount);
    event LeaderFeesWithdrawn(uint256 indexed strategyId, address indexed leader, uint256 amount);
    event AttestationRecorded(uint256 indexed strategyId, bytes32 condition, uint16 slashBps, string evidenceURI);
    event BondSlashed(uint256 indexed strategyId, uint256 amount);
    event CompensationClaimed(uint256 indexed strategyId, address indexed follower, uint256 amount);
    event BondWithdrawn(uint256 indexed strategyId, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyRiskAgent() {
        require(msg.sender == riskAgent, "NOT_RISK_AGENT");
        _;
    }

    modifier onlyLeader(uint256 strategyId) {
        require(msg.sender == strategies[strategyId].leader, "NOT_LEADER");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address usdc_, address riskAgent_) {
        usdc      = IERC20(usdc_);
        riskAgent = riskAgent_;
    }

    // ── Leader: create + fund ─────────────────────────────────────────────────

    /// @notice Create a new copy-trading strategy.
    /// @param mandateURI          IPFS or data-URI pointing to the JSON mandate.
    /// @param benchmark           Reference benchmark string (e.g. "BTC-USD").
    /// @param conditions          keccak256 hashes of slash condition strings.
    /// @param slashBps_           Slash percentages in basis points (max 5000 each).
    /// @param performanceFeeBps_  Leader's cut of follower profits (max 3000 = 30%).
    /// @param subscriptionFeeUsdc_ Flat USDC charged to each new subscriber (can be 0).
    function createStrategy(
        string   calldata mandateURI,
        string   calldata benchmark,
        bytes32[] calldata conditions,
        uint16[]  calldata slashBps_,
        uint16   performanceFeeBps_,
        uint256  subscriptionFeeUsdc_
    ) external returns (uint256 strategyId) {
        require(conditions.length == slashBps_.length, "RULE_LENGTH_MISMATCH");
        require(performanceFeeBps_ <= 3_000, "FEE_TOO_HIGH"); // max 30%

        strategyId = nextStrategyId++;
        strategies[strategyId] = Strategy({
            leader:               msg.sender,
            bond:                 0,
            cooldownEndsAt:       0,
            mandateURI:           mandateURI,
            benchmark:            benchmark,
            status:               StrategyStatus.Active,
            followerCount:        0,
            totalFollowerWeight:  0,
            totalClaimable:       0,
            performanceFeeBps:    performanceFeeBps_,
            subscriptionFeeUsdc:  subscriptionFeeUsdc_,
            totalFeesEarned:      0
        });

        for (uint256 i = 0; i < conditions.length; i++) {
            require(slashBps_[i] <= 5_000, "SLASH_TOO_HIGH");
            slashRules[strategyId].push(SlashRule({ condition: conditions[i], slashBps: slashBps_[i] }));
        }

        emit StrategyCreated(strategyId, msg.sender, mandateURI, performanceFeeBps_, subscriptionFeeUsdc_);
    }

    /// @notice Stake additional USDC bond for an existing strategy.
    function stakeBond(uint256 strategyId, uint256 amount) external onlyLeader(strategyId) {
        require(amount > 0, "ZERO_AMOUNT");
        require(usdc.transferFrom(msg.sender, address(this), amount), "TRANSFER_FAILED");
        strategies[strategyId].bond  += amount;
        strategies[strategyId].status = StrategyStatus.Active;
        emit BondStaked(strategyId, amount);
    }

    // ── Follower: subscribe ───────────────────────────────────────────────────

    /// @notice Subscribe to a strategy.
    ///         If the strategy charges a subscription fee, the follower must have
    ///         approved this contract for at least that amount of USDC.
    ///         The fee is sent directly to the leader's wallet.
    function subscribeFollower(uint256 strategyId, uint256 weight) external {
        Strategy storage strategy = strategies[strategyId];
        require(strategy.status == StrategyStatus.Active, "STRATEGY_NOT_ACTIVE");
        require(weight > 0, "ZERO_WEIGHT");

        // Collect flat subscription fee → directly to leader
        uint256 subFee = strategy.subscriptionFeeUsdc;
        if (subFee > 0) {
            require(usdc.transferFrom(msg.sender, strategy.leader, subFee), "SUB_FEE_FAILED");
            strategy.totalFeesEarned += subFee;
            emit SubscriptionFeePaid(strategyId, msg.sender, subFee);
        }

        uint256 previousWeight = followerWeight[strategyId][msg.sender];
        if (previousWeight == 0) {
            strategy.followerCount++;
        }
        strategy.totalFollowerWeight = strategy.totalFollowerWeight - previousWeight + weight;
        followerWeight[strategyId][msg.sender] = weight;

        emit FollowerSubscribed(strategyId, msg.sender, weight, subFee);
    }

    // ── Risk agent: fee settlement ─────────────────────────────────────────────

    /// @notice Agent calls this when it detects a follower has profited from a
    ///         mirrored trade.  Transfers the performance fee from the follower
    ///         into this contract; the leader withdraws via collectLeaderFees().
    /// @dev    Silently skips if the follower has not approved enough USDC —
    ///         never reverts so the agent can batch multiple settlements.
    function settlePerformanceFee(
        uint256 strategyId,
        address follower,
        uint256 gainUsdc
    ) external onlyRiskAgent {
        uint256 feeBps = strategies[strategyId].performanceFeeBps;
        if (feeBps == 0 || gainUsdc == 0) return;

        uint256 feeAmount = (gainUsdc * feeBps) / 10_000;
        if (feeAmount == 0) return;

        // Only collect if follower has approved enough; never revert
        if (usdc.allowance(follower, address(this)) >= feeAmount) {
            if (usdc.transferFrom(follower, address(this), feeAmount)) {
                leaderFeeBalance[strategyId]             += feeAmount;
                strategies[strategyId].totalFeesEarned  += feeAmount;
                emit PerformanceFeeSettled(strategyId, follower, feeAmount);
            }
        }
    }

    /// @notice Leader withdraws all accumulated performance fees.
    function collectLeaderFees(uint256 strategyId) external onlyLeader(strategyId) {
        uint256 amount = leaderFeeBalance[strategyId];
        require(amount > 0, "NO_FEES");
        leaderFeeBalance[strategyId] = 0;
        require(usdc.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit LeaderFeesWithdrawn(strategyId, msg.sender, amount);
    }

    // ── Risk agent: attestation + slash ───────────────────────────────────────

    function recordAttestation(
        uint256  strategyId,
        bytes32  condition,
        string   calldata evidenceURI,
        uint16   slashBps_
    ) external onlyRiskAgent {
        require(slashBps_ <= 5_000, "SLASH_TOO_HIGH");
        attestations[strategyId].push(Attestation({
            strategyId: strategyId,
            condition:  condition,
            evidenceURI:evidenceURI,
            slashBps:   slashBps_,
            agent:      msg.sender,
            createdAt:  block.timestamp
        }));
        emit AttestationRecorded(strategyId, condition, slashBps_, evidenceURI);
    }

    function slashBond(
        uint256   strategyId,
        address[] calldata affectedFollowers
    ) external onlyRiskAgent {
        Strategy storage strategy = strategies[strategyId];
        require(
            strategy.status == StrategyStatus.Active || strategy.status == StrategyStatus.Paused,
            "NOT_SLASHABLE"
        );
        require(affectedFollowers.length > 0, "NO_FOLLOWERS");
        require(attestations[strategyId].length > 0, "NO_ATTESTATION");

        Attestation memory latest = attestations[strategyId][attestations[strategyId].length - 1];
        uint256 slashAmount = (strategy.bond * latest.slashBps) / 10_000;
        require(slashAmount > 0, "ZERO_SLASH");

        uint256 affectedWeight = 0;
        for (uint256 i = 0; i < affectedFollowers.length; i++) {
            affectedWeight += followerWeight[strategyId][affectedFollowers[i]];
        }
        require(affectedWeight > 0, "NO_AFFECTED_WEIGHT");

        strategy.bond           -= slashAmount;
        strategy.totalClaimable += slashAmount;
        strategy.status          = StrategyStatus.Slashed;

        uint256 distributed = 0;
        for (uint256 i = 0; i < affectedFollowers.length; i++) {
            uint256 share = (slashAmount * followerWeight[strategyId][affectedFollowers[i]]) / affectedWeight;
            if (i == affectedFollowers.length - 1) {
                share = slashAmount - distributed; // dust to last follower
            }
            distributed += share;
            claimable[strategyId][affectedFollowers[i]] += share;
        }

        emit BondSlashed(strategyId, slashAmount);
    }

    // ── Follower: claim compensation ──────────────────────────────────────────

    function claimCompensation(uint256 strategyId) external {
        uint256 amount = claimable[strategyId][msg.sender];
        require(amount > 0, "NOTHING_TO_CLAIM");
        claimable[strategyId][msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit CompensationClaimed(strategyId, msg.sender, amount);
    }

    // ── Leader: cooldown withdrawal ───────────────────────────────────────────

    function startWithdrawCooldown(
        uint256 strategyId,
        uint256 cooldownSeconds
    ) external onlyLeader(strategyId) {
        strategies[strategyId].status          = StrategyStatus.Paused;
        strategies[strategyId].cooldownEndsAt  = block.timestamp + cooldownSeconds;
    }

    function withdrawBondAfterCooldown(uint256 strategyId) external onlyLeader(strategyId) {
        Strategy storage strategy = strategies[strategyId];
        require(strategy.cooldownEndsAt != 0 && block.timestamp >= strategy.cooldownEndsAt, "COOLDOWN_ACTIVE");
        uint256 amount = strategy.bond;
        strategy.bond   = 0;
        strategy.status = StrategyStatus.Withdrawn;
        require(usdc.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit BondWithdrawn(strategyId, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function slashRuleCount(uint256 strategyId) external view returns (uint256) {
        return slashRules[strategyId].length;
    }

    function attestationCount(uint256 strategyId) external view returns (uint256) {
        return attestations[strategyId].length;
    }
}
