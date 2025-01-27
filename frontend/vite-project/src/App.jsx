import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import axios from "axios";
import Spinner from "./components/Spinner";
import JsonDisplay from "./components/JsonDisplay";
import VerificationDetails from "./components/VerificationDetails";
import { CONTRACT_ABI, CONTRACT_ADDRESS } from "./utils/contractConfig";

const App = () => {
  const [income, setIncome] = useState("");
  const [threshold, setThreshold] = useState(50000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verificationResult, setVerificationResult] = useState(null);
  const [account, setAccount] = useState(null);
  const [contract, setContract] = useState(null);

  useEffect(() => {
    initializeEthereum();
  }, []);

  const initializeEthereum = async () => {
    try {
      if (window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        });

        setAccount(accounts[0]);
        const signer = await provider.getSigner();

        const contract = new ethers.Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          signer
        );
        setContract(contract);

        // Listen for account changes
        window.ethereum.on("accountsChanged", (accounts) => {
          setAccount(accounts[0]);
        });
      } else {
        setError("Please install MetaMask to use this application");
      }
    } catch (err) {
      console.error("Ethereum initialization error:", err);
      setError("Failed to connect to Ethereum wallet");
    }
  };

  const handleGenerateAndVerifyProof = async () => {
    if (!income || isNaN(income)) {
      setError("Please enter a valid income.");
      return;
    }

    if (!account) {
      setError("Please connect your wallet first.");
      return;
    }

    setLoading(true);
    setError("");
    setVerificationResult(null);

    try {
      // Generate and verify proof
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/generate-and-verify-proof`,
        {
          income: parseInt(income),
          threshold,
          address: account,
        }
      );

      const result = response.data;

      if (result.isValid && result.details.attestationId) {
        // Setup contract event listener
        contract.on("IncomeVerified", (user, attestationId) => {
          if (user.toLowerCase() === account.toLowerCase()) {
            setVerificationResult({
              ...result,
              contractEvent: {
                user,
                attestationId: attestationId.toString(),
              },
            });
          }
        });

        // Call contract method
        // try {
        //   const tx = await contract.verifyIncomeProof(
        //     result.details.attestationId,
        //     result.details.merkleProof.proof,
        //     result.details.merkleProof.numberOfLeaves,
        //     result.details.merkleProof.leafIndex,
        //     {
        //       gasLimit: 500000, // Add explicit gas limit
        //     }
        //   );

        //   console.log("Transaction sent:", tx.hash);
        //   const receipt = await tx.wait();
        //   console.log("Transaction mined:", receipt);

        //   result.contractVerification = {
        //     success: true,
        //     txHash: receipt.hash,
        //   };
        // } catch (error) {
        //   console.error("Contract error details:", {
        //     message: error.message,
        //     code: error.code,
        //     reason: error.reason,
        //     transaction: error.transaction,
        //   });

        //   // Handle specific error cases
        //   let errorMessage = "Contract verification failed";
        //   if (error.reason) {
        //     errorMessage = error.reason;
        //   } else if (error.message.includes("user rejected")) {
        //     errorMessage = "Transaction was rejected by user";
        //   }

        //   result.contractVerification = {
        //     success: false,
        //     error: errorMessage,
        //   };
        // }

        setVerificationResult(result);
      } else {
        setError("Proof verification failed");
      }
    } catch (error) {
      console.error("Error:", error);
      setError(error.response?.data?.error || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-12">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
          Zero Knowledge Proof of Income
        </h1>

        {account ? (
          <p className="text-sm text-gray-600 mb-4">
            Connected Account: {account}
          </p>
        ) : (
          <button
            onClick={initializeEthereum}
            className="w-full mb-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            Connect Wallet
          </button>
        )}

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Income:
            </label>
            <input
              type="number"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter your income"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Threshold:
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter the threshold"
            />
          </div>

          <button
            onClick={handleGenerateAndVerifyProof}
            disabled={loading || !account}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300 transition-colors"
          >
            {loading ? <Spinner /> : "Generate & Verify Proof"}
          </button>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-center">{error}</p>
            </div>
          )}

          {verificationResult && (
            <VerificationDetails result={verificationResult} />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
