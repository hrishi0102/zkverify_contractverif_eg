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

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// Environment check
console.log("Environment check:", {
  ETH_RPC_URL: process.env.ETH_RPC_URL ? "Set" : "Not set",
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
  HAS_PRIVATE_KEY: !!process.env.ETH_PRIVATE_KEY,
});

// Load proving and verification keys
const zkeyPath = "../output/incomeProof_0001.zkey";
const vkey = JSON.parse(fs.readFileSync("../output/verification_key.json"));

// Initialize zkVerify session
let zkSession;
async function initZkVerifySession() {
  try {
    zkSession = await zkVerifySession
      .start()
      .Custom(process.env.ZKV_RPC_URL)
      .withAccount(process.env.ZKV_SEED_PHRASE);
    console.log("ZkVerify session initialized");
  } catch (error) {
    console.error("Failed to initialize zkVerify session:", error);
  }
}

// Ethereum provider and contract setup
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL, null, {
  polling: true,
});
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, provider);
const evmAccount = ethers.computeAddress(process.env.ETH_PRIVATE_KEY);

console.log("Initializing contract at address:", process.env.CONTRACT_ADDRESS);

app.post("/generate-and-verify-proof", async (req, res) => {
  let verificationStatus = {
    isValid: false,
    details: {},
    contractVerification: null,
  };

  try {
    const { income, threshold } = req.body;
    console.log(
      "Generating proof for income:",
      income,
      "threshold:",
      threshold
    );

    // Generate proof using snarkjs
    const { proof, publicSignals } = await groth16.fullProve(
      { address: evmAccount, income, threshold },
      "../output/incomeProof_js/incomeProof.wasm",
      zkeyPath
    );

    console.log("Generated proof:", proof);
    console.log("Public signals:", publicSignals);

    if (!zkSession) {
      await initZkVerifySession();
    }

    console.log("Submitting proof to zkVerify...");

    // Submit proof to zkVerify
    const { events, transactionResult } = await zkSession
      .verify()
      .groth16(Library.snarkjs, CurveType.bn128)
      .waitForPublishedAttestation()
      .execute({
        proofData: {
          vk: vkey,
          proof,
          publicSignals,
        },
      });

    // Handle zkVerify events
    events.on(ZkVerifyEvents.IncludedInBlock, ({ txHash }) => {
      console.log(`Transaction accepted in zkVerify, tx-hash: ${txHash}`);
    });

    // Listen for the 'finalized' event
    events.on(ZkVerifyEvents.Finalized, ({ blockHash }) => {
      console.log(
        `Transaction finalized in zkVerify, block-hash: ${blockHash}`
      );
    });

    verificationStatus.isValid = true;
    verificationStatus.details = { txHash: transactionResult.txHash };

    // Handle errors during the transaction process
    events.on("error", (error) => {
      console.error("An error occurred during the transaction:", error);
    });

    let attestationId, leafDigest;
    try {
      ({ attestationId, leafDigest } = await transactionResult);
      console.log(`Attestation published on zkVerify`);
      console.log(`\tattestationId: ${attestationId}`);
      console.log(`\tleafDigest: ${leafDigest}`);
      verificationStatus.details = {
        attestationId: attestationId,
        leafDigest: leafDigest,
      };
    } catch (error) {
      console.error("Transaction failed:", error);
    }

    let merkleProof, numberOfLeaves, leafIndex;
    try {
      const proofDetails = await zkSession.poe(attestationId, leafDigest);
      ({ proof: merkleProof, numberOfLeaves, leafIndex } = await proofDetails);
      console.log(`Merkle proof details`);
      console.log(`\tmerkleProof: ${merkleProof}`);
      console.log(`\tnumberOfLeaves: ${numberOfLeaves}`);
      console.log(`\tleafIndex: ${leafIndex}`);

      verificationStatus.details.merkleProof = {
        proof: proofDetails.proof,
        numberOfLeaves: proofDetails.numberOfLeaves,
        leafIndex: proofDetails.leafIndex,
      };
    } catch (error) {
      console.error("RPC failed:", error);
    }

    // Check if merkleProof is empty
    if (merkleProof.length === 0) {
      console.error(
        "Merkle proof is empty. Cannot proceed with contract verification."
      );
      verificationStatus.details.error = "Merkle proof is empty";
    }

    const abiZkvContract = [
      "event AttestationPosted(uint256 indexed attestationId, bytes32 indexed root)",
    ];

    const abiAppContract = [
      "function verifyIncomeProof(uint256 attestationId, bytes32[] calldata merklePath, uint256 leafCount, uint256 index)",
      "event SuccessfulProofSubmission(address indexed from)",
    ];

    // Create contract instance with the wallet
    const appContract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      abiAppContract,
      wallet
    );

    const zkvContract = new ethers.Contract(
      process.env.ZKV_CONTRACT_ADDRESS,
      abiZkvContract,
      provider
    );

    // Call the contract method directly
    console.log("Calling contract method...");

    const filterAttestationsById = zkvContract.filters.AttestationPosted(
      attestationId,
      null
    );
    console.log("Filtering for attestationId:", attestationId);

    console.log("Transaction details:", {
      attestationId: attestationId,
      merkleProof: verificationStatus.details.merkleProof.proof,
      numberOfLeaves: verificationStatus.details.merkleProof.numberOfLeaves,
      leafIndex: verificationStatus.details.merkleProof.leafIndex,
    });

    zkvContract.once(filterAttestationsById, async (_id, _root) => {
      // After the attestation has been posted on the EVM, send a `verifyIncomeProof` tx
      // to the app contract, with all the necessary merkle proof details
      const txResponse = await appContract.verifyIncomeProof(
        attestationId, // Convert to BigInt
        verificationStatus.details.merkleProof.proof, // Pass the proof array directly
        verificationStatus.details.merkleProof.numberOfLeaves, // Convert to BigInt
        verificationStatus.details.merkleProof.proofleafIndex
      );
      const { hash } = await txResponse;
      console.log(`Tx sent to EVM, tx-hash ${hash}`);
      console.log("Waiting for confirmation...");

      verificationStatus.contractVerification = {
        success: true,
        txHash: hash,
      };
    });

    const filterAppEventsByCaller =
      appContract.filters.SuccessfulProofSubmission(evmAccount);
    appContract.once(filterAppEventsByCaller, async () => {
      console.log(
        "App contract has acknowledged that your income is above threshold!"
      );
    });
  } catch (error) {
    console.error("Server error:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      data: error.data,
      transaction: error.transaction,
    });
    verificationStatus.details.error = error.message;
  }
  res.json(verificationStatus);
});

app.listen(PORT, async () => {
  await initZkVerifySession();
  console.log(`Server running on http://localhost:${PORT}`);
});
