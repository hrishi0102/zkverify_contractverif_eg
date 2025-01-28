import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import axios from "axios";
import Spinner from "./components/Spinner";
import VerificationDetails from "./components/VerificationDetails";

const App = () => {
  const [income, setIncome] = useState("");
  const [threshold, setThreshold] = useState(50000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verificationResult, setVerificationResult] = useState(null);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    initializeEthereum();
  }, []);

  const initializeEthereum = async () => {
    try {
      if (!window.ethereum) {
        throw new Error("Please install MetaMask to use this application");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      setAccount(accounts[0]);

      // Listen for account changes
      window.ethereum.on("accountsChanged", (newAccounts) => {
        setAccount(newAccounts[0]);
      });
    } catch (err) {
      console.error("Ethereum initialization error:", err);
      setError(err.message || "Failed to connect to Ethereum wallet");
    }
  };

  const validateInput = () => {
    if (!income || isNaN(income) || parseInt(income) <= 0) {
      setError("Please enter a valid income amount");
      return false;
    }

    if (!account) {
      setError("Please connect your wallet first");
      return false;
    }

    return true;
  };

  const handleGenerateAndVerifyProof = async () => {
    if (!validateInput()) return;

    setLoading(true);
    setError("");
    setVerificationResult(null);

    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/generate-and-verify-proof`,
        {
          income: parseInt(income),
          threshold,
          address: account,
        }
      );

      const result = response.data;

      if (!result.isValid) {
        throw new Error("Proof verification failed");
      }

      setVerificationResult(result);
    } catch (error) {
      console.error("Error in proof generation:", error);
      setError(
        error.response?.data?.error ||
          error.message ||
          "Failed to generate and verify proof"
      );
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
            className="w-full mb-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium 
                     hover:bg-blue-700 focus:outline-none focus:ring-2 
                     focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300 
                     transition-colors"
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
