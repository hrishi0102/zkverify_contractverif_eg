const express = require("express");
const cors = require("cors");
const { groth16 } = require("snarkjs");
const {
  zkVerifySession,
  ZkVerifyEvents,
  Library,
  CurveType,
} = require("zkverifyjs");
const { ethers } = require("ethers");
const fs = require("fs");
require("dotenv").config();

// Constants
const PORT = 3001;
const ZKEY_PATH = "../output/incomeProof_0001.zkey";
const WASM_PATH = "../output/incomeProof_js/incomeProof.wasm";
const VERIFICATION_KEY_PATH = "../output/verification_key.json";

// Contract ABIs
const ZKV_CONTRACT_ABI = [
  "event AttestationPosted(uint256 indexed attestationId, bytes32 indexed root)",
];
const APP_CONTRACT_ABI = [
  "function verifyIncomeProof(uint256 attestationId, bytes32[] calldata merklePath, uint256 leafCount, uint256 index)",
  "event SuccessfulProofSubmission(address indexed from)",
];

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Environment check
console.log("Environment check:", {
  ETH_RPC_URL: process.env.ETH_RPC_URL ? "Set" : "Not set",
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  HAS_PRIVATE_KEY: !!process.env.ETH_PRIVATE_KEY,
  ZKV_RPC_URL: process.env.ZKV_RPC_URL ? "Set" : "Not set",
});

// Load verification key
const vkey = JSON.parse(fs.readFileSync(VERIFICATION_KEY_PATH));
console.log("Verification key loaded successfully");

// Initialize provider and wallet
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL, null, {
  polling: true,
});
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, provider);
const evmAccount = ethers.computeAddress(process.env.ETH_PRIVATE_KEY);
console.log("Ethereum account initialized:", evmAccount);

let zkSession;

// Initialize zkVerify session
async function initZkVerifySession() {
  try {
    zkSession = await zkVerifySession
      .start()
      .Custom(process.env.ZKV_RPC_URL)
      .withAccount(process.env.ZKV_SEED_PHRASE);
    console.log("ZkVerify session initialized successfully");
  } catch (error) {
    console.error("Failed to initialize zkVerify session:", error);
    throw error;
  }
}

// Generate and verify proof
async function generateProof(income, threshold) {
  console.log("Generating proof for:", { income, threshold });
  const result = await groth16.fullProve(
    { address: evmAccount, income, threshold },
    WASM_PATH,
    ZKEY_PATH
  );
  console.log("Proof generated successfully");
  console.log("Public signals:", result.publicSignals);
  return result;
}

// Submit proof to zkVerify
async function submitProofToZkVerify(proof, publicSignals) {
  console.log("Submitting proof to zkVerify...");

  const { events, transactionResult } = await zkSession
    .verify()
    .groth16(Library.snarkjs, CurveType.bn128)
    .waitForPublishedAttestation()
    .execute({
      proofData: { vk: vkey, proof, publicSignals },
    });

  // Handle zkVerify events
  events.on(ZkVerifyEvents.IncludedInBlock, ({ txHash }) => {
    console.log(`Transaction accepted in zkVerify, tx-hash: ${txHash}`);
  });

  events.on(ZkVerifyEvents.Finalized, ({ blockHash }) => {
    console.log(`Transaction finalized in zkVerify, block-hash: ${blockHash}`);
  });

  events.on("error", (error) => {
    console.error("An error occurred during zkVerify transaction:", error);
  });

  const { attestationId, leafDigest } = await transactionResult;
  console.log("Attestation published on zkVerify:", {
    attestationId,
    leafDigest,
  });

  return { attestationId, leafDigest, txHash };
}

// Get Merkle proof details
async function getMerkleProofDetails(attestationId, leafDigest) {
  console.log("Getting Merkle proof details for:", {
    attestationId,
    leafDigest,
  });

  const proofDetails = await zkSession.poe(attestationId, leafDigest);
  console.log("Merkle proof details received:", {
    numberOfLeaves: proofDetails.numberOfLeaves,
    leafIndex: proofDetails.leafIndex,
    proofLength: proofDetails.proof.length,
  });

  return {
    proof: proofDetails.proof,
    numberOfLeaves: proofDetails.numberOfLeaves,
    leafIndex: proofDetails.leafIndex,
  };
}

// Verify proof on contract
async function verifyProofOnContract(attestationId, merkleProofDetails) {
  console.log("Initializing contract verification...");
  console.log("Contract address:", process.env.CONTRACT_ADDRESS);

  const appContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    APP_CONTRACT_ABI,
    wallet
  );
  const zkvContract = new ethers.Contract(
    process.env.ZKV_CONTRACT_ADDRESS,
    ZKV_CONTRACT_ABI,
    provider
  );

  return new Promise((resolve, reject) => {
    const filterAttestationsById = zkvContract.filters.AttestationPosted(
      attestationId,
      null
    );
    console.log("Filtering for attestationId:", attestationId);

    console.log("Transaction parameters:", {
      attestationId: BigInt(attestationId),
      numberOfLeaves: BigInt(merkleProofDetails.numberOfLeaves),
      leafIndex: BigInt(merkleProofDetails.leafIndex),
    });

    zkvContract.once(filterAttestationsById, async () => {
      try {
        const txResponse = await appContract.verifyIncomeProof(
          BigInt(attestationId),
          merkleProofDetails.proof.map((p) => ethers.hexlify(p)),
          BigInt(merkleProofDetails.numberOfLeaves),
          BigInt(merkleProofDetails.leafIndex)
        );

        console.log(`Transaction sent to EVM, tx-hash: ${txResponse.hash}`);
        console.log("Waiting for confirmation...");

        const receipt = await txResponse.wait();
        console.log("Transaction confirmed:", receipt.hash);

        // Listen for successful proof submission
        const filter =
          appContract.filters.SuccessfulProofSubmission(evmAccount);
        appContract.once(filter, () => {
          console.log("Income proof verification successful!");
        });

        resolve({ success: true, txHash: receipt.hash });
      } catch (error) {
        console.error("Contract verification failed:", error);
        console.error("Error details:", {
          message: error.message,
          code: error.code,
          data: error.data,
          transaction: error.transaction,
        });
        reject({ success: false, error: error.message });
      }
    });
  });
}

// Main endpoint
app.post("/generate-and-verify-proof", async (req, res) => {
  console.log("Received proof generation request");

  try {
    const { income, threshold } = req.body;
    console.log("Request parameters:", { income, threshold });

    // Ensure zkSession is initialized
    if (!zkSession) {
      console.log("Initializing zkSession...");
      await initZkVerifySession();
    }

    // Step 1: Generate proof
    console.log("Step 1: Generating proof...");
    const { proof, publicSignals } = await generateProof(income, threshold);

    // Step 2: Submit to zkVerify
    console.log("Step 2: Submitting to zkVerify...");
    const { attestationId, leafDigest } = await submitProofToZkVerify(
      proof,
      publicSignals
    );

    // Step 3: Get Merkle proof details
    console.log("Step 3: Getting Merkle proof details...");
    const merkleProofDetails = await getMerkleProofDetails(
      attestationId,
      leafDigest
    );

    // Step 4: Verify on contract
    console.log("Step 4: Verifying on contract...");
    const contractVerification = await verifyProofOnContract(
      attestationId,
      merkleProofDetails
    );

    // Step 5: Prepare and send response
    const response = {
      isValid: true,
      details: {
        attestationId,
        txHash,
        leafDigest,
        merkleProof: merkleProofDetails,
      },
      contractVerification,
    };

    console.log(
      "Sending successful response:",
      JSON.stringify(response, null, 2)
    );
    res.json(response);
  } catch (error) {
    console.error("Error in proof generation and verification:", error);
    const errorResponse = {
      isValid: false,
      details: { error: error.message },
      contractVerification: null,
    };
    console.log(
      "Sending error response:",
      JSON.stringify(errorResponse, null, 2)
    );
    res.status(500).json(errorResponse);
  }
});

// Start server
app.listen(PORT, async () => {
  try {
    await initZkVerifySession();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("Initial setup complete - ready to process requests");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});
