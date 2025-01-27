const CONTRACT_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_zkvContract",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_vkHash",
        type: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "reason",
        type: "string",
      },
    ],
    name: "InvalidProofAttestation",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "attestationId",
        type: "uint256",
      },
    ],
    name: "IncomeVerified",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "hasVerifiedIncome",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "attestationId",
        type: "uint256",
      },
      {
        internalType: "bytes32[]",
        name: "merklePath",
        type: "bytes32[]",
      },
      {
        internalType: "uint256",
        name: "leafCount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "verifyIncomeProof",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
