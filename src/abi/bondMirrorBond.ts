export const bondMirrorBondAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'usdc_',      type: 'address' },
      { name: 'riskAgent_', type: 'address' },
    ],
  },
  // ── Views ──────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'nextStrategyId',
    stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'strategies',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'leader',               type: 'address'  },
      { name: 'bond',                 type: 'uint256'  },
      { name: 'cooldownEndsAt',       type: 'uint256'  },
      { name: 'mandateURI',           type: 'string'   },
      { name: 'benchmark',            type: 'string'   },
      { name: 'status',               type: 'uint8'    },
      { name: 'followerCount',        type: 'uint256'  },
      { name: 'totalFollowerWeight',  type: 'uint256'  },
      { name: 'totalClaimable',       type: 'uint256'  },
      { name: 'performanceFeeBps',    type: 'uint16'   },
      { name: 'subscriptionFeeUsdc',  type: 'uint256'  },
      { name: 'totalFeesEarned',      type: 'uint256'  },
    ],
  },
  {
    type: 'function', name: 'claimable',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'leaderFeeBalance',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'attestationCount',
    stateMutability: 'view',
    inputs: [{ name: 'strategyId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'attestations',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'uint256' }],
    outputs: [
      { name: 'strategyId',  type: 'uint256'  },
      { name: 'condition',   type: 'bytes32'  },
      { name: 'evidenceURI', type: 'string'   },
      { name: 'slashBps',    type: 'uint16'   },
      { name: 'agent',       type: 'address'  },
      { name: 'createdAt',   type: 'uint256'  },
    ],
  },
  // ── Writes ─────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'createStrategy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'mandateURI',            type: 'string'   },
      { name: 'benchmark',             type: 'string'   },
      { name: 'conditions',            type: 'bytes32[]'},
      { name: 'slashBps_',             type: 'uint16[]' },
      { name: 'performanceFeeBps_',    type: 'uint16'   },
      { name: 'subscriptionFeeUsdc_',  type: 'uint256'  },
    ],
    outputs: [{ name: 'strategyId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'stakeBond',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'strategyId', type: 'uint256' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'subscribeFollower',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'strategyId', type: 'uint256' }, { name: 'weight', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'collectLeaderFees',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'strategyId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'settlePerformanceFee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strategyId', type: 'uint256' },
      { name: 'follower',   type: 'address' },
      { name: 'gainUsdc',   type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'recordAttestation',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strategyId',  type: 'uint256' },
      { name: 'condition',   type: 'bytes32' },
      { name: 'evidenceURI', type: 'string'  },
      { name: 'slashBps_',   type: 'uint16'  },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'slashBond',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strategyId',       type: 'uint256'   },
      { name: 'affectedFollowers',type: 'address[]' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'claimCompensation',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'strategyId', type: 'uint256' }],
    outputs: [],
  },
  // ── Events ──────────────────────────────────────────────────────────────────
  {
    type: 'event', name: 'StrategyCreated',
    inputs: [
      { name: 'strategyId',          type: 'uint256', indexed: true  },
      { name: 'leader',              type: 'address', indexed: true  },
      { name: 'mandateURI',          type: 'string',  indexed: false },
      { name: 'performanceFeeBps',   type: 'uint16',  indexed: false },
      { name: 'subscriptionFeeUsdc', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'BondStaked',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'FollowerSubscribed',
    inputs: [
      { name: 'strategyId',         type: 'uint256', indexed: true  },
      { name: 'follower',           type: 'address', indexed: true  },
      { name: 'weight',             type: 'uint256', indexed: false },
      { name: 'subscriptionFeePaid',type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'SubscriptionFeePaid',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'follower',   type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PerformanceFeeSettled',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'follower',   type: 'address', indexed: true  },
      { name: 'feeAmount',  type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'LeaderFeesWithdrawn',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'leader',     type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'AttestationRecorded',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'condition',  type: 'bytes32', indexed: false },
      { name: 'slashBps',   type: 'uint16',  indexed: false },
      { name: 'evidenceURI',type: 'string',  indexed: false },
    ],
  },
  {
    type: 'event', name: 'BondSlashed',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'CompensationClaimed',
    inputs: [
      { name: 'strategyId', type: 'uint256', indexed: true  },
      { name: 'follower',   type: 'address', indexed: true  },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
] as const
