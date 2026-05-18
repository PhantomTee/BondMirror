// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

contract BondMirrorBond {
    enum StrategyStatus {
        Active,
        Paused,
        Slashed,
        Withdrawn
    }

    struct SlashRule {
        bytes32 condition;
        uint16 slashBps;
    }

    struct Strategy {
        address leader;
        uint256 bond;
        uint256 cooldownEndsAt;
        string mandateURI;
        string benchmark;
        StrategyStatus status;
        uint256 followerCount;
        uint256 totalFollowerWeight;
        uint256 totalClaimable;
    }

    struct Attestation {
        uint256 strategyId;
        bytes32 condition;
        string evidenceURI;
        uint16 slashBps;
        address agent;
        uint256 createdAt;
    }

    IERC20 public immutable usdc;
    address public riskAgent;
    uint256 public nextStrategyId = 1;

    mapping(uint256 => Strategy) public strategies;
    mapping(uint256 => SlashRule[]) public slashRules;
    mapping(uint256 => Attestation[]) public attestations;
    mapping(uint256 => mapping(address => uint256)) public followerWeight;
    mapping(uint256 => mapping(address => uint256)) public claimable;

    event StrategyCreated(uint256 indexed strategyId, address indexed leader, string mandateURI);
    event BondStaked(uint256 indexed strategyId, uint256 amount);
    event FollowerSubscribed(uint256 indexed strategyId, address indexed follower, uint256 weight);
    event AttestationRecorded(uint256 indexed strategyId, bytes32 condition, uint16 slashBps, string evidenceURI);
    event BondSlashed(uint256 indexed strategyId, uint256 amount);
    event CompensationClaimed(uint256 indexed strategyId, address indexed follower, uint256 amount);
    event BondWithdrawn(uint256 indexed strategyId, uint256 amount);

    modifier onlyRiskAgent() {
        require(msg.sender == riskAgent, "NOT_RISK_AGENT");
        _;
    }

    modifier onlyLeader(uint256 strategyId) {
        require(msg.sender == strategies[strategyId].leader, "NOT_LEADER");
        _;
    }

    constructor(address usdc_, address riskAgent_) {
        usdc = IERC20(usdc_);
        riskAgent = riskAgent_;
    }

    function createStrategy(
        string calldata mandateURI,
        string calldata benchmark,
        bytes32[] calldata conditions,
        uint16[] calldata slashBps
    ) external returns (uint256 strategyId) {
        require(conditions.length == slashBps.length, "RULE_LENGTH_MISMATCH");
        strategyId = nextStrategyId++;
        strategies[strategyId] = Strategy({
            leader: msg.sender,
            bond: 0,
            cooldownEndsAt: 0,
            mandateURI: mandateURI,
            benchmark: benchmark,
            status: StrategyStatus.Active,
            followerCount: 0,
            totalFollowerWeight: 0,
            totalClaimable: 0
        });

        for (uint256 i = 0; i < conditions.length; i++) {
            require(slashBps[i] <= 5_000, "SLASH_TOO_HIGH");
            slashRules[strategyId].push(SlashRule({condition: conditions[i], slashBps: slashBps[i]}));
        }

        emit StrategyCreated(strategyId, msg.sender, mandateURI);
    }

    function stakeBond(uint256 strategyId, uint256 amount) external onlyLeader(strategyId) {
        require(amount > 0, "ZERO_AMOUNT");
        require(usdc.transferFrom(msg.sender, address(this), amount), "TRANSFER_FAILED");
        strategies[strategyId].bond += amount;
        strategies[strategyId].status = StrategyStatus.Active;
        emit BondStaked(strategyId, amount);
    }

    function subscribeFollower(uint256 strategyId, uint256 weight) external {
        Strategy storage strategy = strategies[strategyId];
        require(strategy.status == StrategyStatus.Active, "STRATEGY_NOT_ACTIVE");
        require(weight > 0, "ZERO_WEIGHT");
        uint256 previousWeight = followerWeight[strategyId][msg.sender];
        if (followerWeight[strategyId][msg.sender] == 0) {
            strategy.followerCount++;
        }
        strategy.totalFollowerWeight = strategy.totalFollowerWeight - previousWeight + weight;
        followerWeight[strategyId][msg.sender] = weight;
        emit FollowerSubscribed(strategyId, msg.sender, weight);
    }

    function recordAttestation(
        uint256 strategyId,
        bytes32 condition,
        string calldata evidenceURI,
        uint16 slashBps
    ) external onlyRiskAgent {
        require(slashBps <= 5_000, "SLASH_TOO_HIGH");
        attestations[strategyId].push(Attestation({
            strategyId: strategyId,
            condition: condition,
            evidenceURI: evidenceURI,
            slashBps: slashBps,
            agent: msg.sender,
            createdAt: block.timestamp
        }));
        emit AttestationRecorded(strategyId, condition, slashBps, evidenceURI);
    }

    function slashBond(uint256 strategyId, address[] calldata affectedFollowers) external onlyRiskAgent {
        Strategy storage strategy = strategies[strategyId];
        require(strategy.status == StrategyStatus.Active || strategy.status == StrategyStatus.Paused, "NOT_SLASHABLE");
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

        strategy.bond -= slashAmount;
        strategy.totalClaimable += slashAmount;
        strategy.status = StrategyStatus.Slashed;

        uint256 distributed = 0;
        for (uint256 i = 0; i < affectedFollowers.length; i++) {
            uint256 share = (slashAmount * followerWeight[strategyId][affectedFollowers[i]]) / affectedWeight;
            if (i == affectedFollowers.length - 1) {
                share = slashAmount - distributed;
            }
            distributed += share;
            claimable[strategyId][affectedFollowers[i]] += share;
        }

        emit BondSlashed(strategyId, slashAmount);
    }

    function claimCompensation(uint256 strategyId) external {
        uint256 amount = claimable[strategyId][msg.sender];
        require(amount > 0, "NOTHING_TO_CLAIM");
        claimable[strategyId][msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit CompensationClaimed(strategyId, msg.sender, amount);
    }

    function startWithdrawCooldown(uint256 strategyId, uint256 cooldownSeconds) external onlyLeader(strategyId) {
        strategies[strategyId].status = StrategyStatus.Paused;
        strategies[strategyId].cooldownEndsAt = block.timestamp + cooldownSeconds;
    }

    function withdrawBondAfterCooldown(uint256 strategyId) external onlyLeader(strategyId) {
        Strategy storage strategy = strategies[strategyId];
        require(strategy.cooldownEndsAt != 0 && block.timestamp >= strategy.cooldownEndsAt, "COOLDOWN_ACTIVE");
        uint256 amount = strategy.bond;
        strategy.bond = 0;
        strategy.status = StrategyStatus.Withdrawn;
        require(usdc.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit BondWithdrawn(strategyId, amount);
    }

    function slashRuleCount(uint256 strategyId) external view returns (uint256) {
        return slashRules[strategyId].length;
    }

    function attestationCount(uint256 strategyId) external view returns (uint256) {
        return attestations[strategyId].length;
    }
}
