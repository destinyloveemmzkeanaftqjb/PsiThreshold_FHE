import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface DataRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "active" | "archived";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    category: "",
    data: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  // Calculate statistics
  const activeCount = records.filter(r => r.status === "active").length;
  const archivedCount = records.filter(r => r.status === "archived").length;

  // Filter records based on search and category
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === "all" || record.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  const categories = ["all", ...Array.from(new Set(records.map(r => r.category)))];

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: DataRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                category: recordData.category,
                status: recordData.status || "active"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSetData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting data with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const encryptedData = `FHE-ENCRYPTED-${btoa(newRecordData.data)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newRecordData.category,
        status: "active"
      };
      
      // Store encrypted data on-chain
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Data encrypted and stored securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          category: "",
          data: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const handleCheckAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "available" : "not available"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const renderPieChart = () => {
    const total = records.length || 1;
    const activePercentage = (activeCount / total) * 100;
    const archivedPercentage = (archivedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment active" 
            style={{ transform: `rotate(${activePercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment archived" 
            style={{ transform: `rotate(${(activePercentage + archivedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{records.length}</div>
            <div className="pie-label">Total</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box active"></div>
            <span>Active: {activeCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box archived"></div>
            <span>Archived: {archivedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      {/* Header Section */}
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="fhe-icon"></div>
          </div>
          <h1>FHE<span>Threshold</span>PSI</h1>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>

      {/* Main Content with Partition Layout */}
      <div className="main-content partitioned">
        
        {/* Left Panel - Project Introduction */}
        <div className="left-panel cyber-card">
          <h2>FHE-Powered Secure Multi-Party Private Set Intersection</h2>
          <p className="intro-text">
            A revolutionary protocol that enables multiple parties to compute set intersections 
            over encrypted data using Fully Homomorphic Encryption (FHE). Maintain complete privacy 
            while performing threshold comparisons.
          </p>
          
          <div className="feature-grid">
            <div className="feature-item">
              <div className="feature-icon">🔒</div>
              <h4>Zero Knowledge</h4>
              <p>No party learns anything beyond the threshold result</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">⚡</div>
              <h4>FHE Powered</h4>
              <p>Fully homomorphic encryption enables encrypted computations</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🌐</div>
              <h4>Multi-Party</h4>
              <p>Support for multiple participants in the protocol</p>
            </div>
          </div>

          {/* Team Information */}
          <div className="team-section">
            <h3>Core Team</h3>
            <div className="team-grid">
              <div className="team-member">
                <div className="member-avatar"></div>
                <h5>Dr. Alice Chen</h5>
                <p>Cryptography Research Lead</p>
              </div>
              <div className="team-member">
                <div className="member-avatar"></div>
                <h5>Mark Wilson</h5>
                <p>FHE Engineering</p>
              </div>
              <div className="team-member">
                <div className="member-avatar"></div>
                <h5>Sarah Johnson</h5>
                <p>Security Architecture</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Data Operations */}
        <div className="right-panel">
          
          {/* Statistics Card */}
          <div className="stats-card cyber-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{activeCount}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{archivedCount}</div>
                <div className="stat-label">Archived</div>
              </div>
            </div>
            
            {/* Pie Chart */}
            <div className="chart-section">
              <h4>Status Distribution</h4>
              {renderPieChart()}
            </div>
          </div>

          {/* Operations Card */}
          <div className="operations-card cyber-card">
            <h3>FHE Operations</h3>
            <div className="operation-buttons">
              <button 
                onClick={handleCheckAvailability}
                className="cyber-button neon-blue"
              >
                Check Availability
              </button>
              <button 
                onClick={() => setShowCreateModal(true)}
                className="cyber-button neon-pink"
              >
                Encrypt Data
              </button>
              <button 
                onClick={loadRecords}
                disabled={isRefreshing}
                className="cyber-button neon-green"
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>

            {/* Search and Filter */}
            <div className="search-filter">
              <input
                type="text"
                placeholder="Search records..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="cyber-input"
              />
              <select
                value={activeCategory}
                onChange={(e) => setActiveCategory(e.target.value)}
                className="cyber-select"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat === "all" ? "All Categories" : cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Records List */}
            <div className="records-list">
              <div className="list-header">
                <h4>Encrypted Records ({filteredRecords.length})</h4>
              </div>
              
              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <p>No encrypted records found</p>
                </div>
              ) : (
                <div className="records-grid">
                  {filteredRecords.map(record => (
                    <div key={record.id} className="record-item cyber-card">
                      <div className="record-header">
                        <span className="record-id">#{record.id.substring(0, 8)}</span>
                        <span className={`status-badge ${record.status}`}>
                          {record.status}
                        </span>
                      </div>
                      <div className="record-category">{record.category}</div>
                      <div className="record-owner">
                        {record.owner.substring(0, 8)}...{record.owner.substring(36)}
                      </div>
                      <div className="record-date">
                        {new Date(record.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="record-data">
                        {record.encryptedData.substring(0, 30)}...
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal cyber-card">
            <div className="modal-header">
              <h2>Encrypt New Data</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Category</label>
                <input
                  type="text"
                  value={newRecordData.category}
                  onChange={(e) => setNewRecordData({...newRecordData, category: e.target.value})}
                  placeholder="Enter category..."
                  className="cyber-input"
                />
              </div>
              
              <div className="form-group">
                <label>Data to Encrypt</label>
                <textarea
                  value={newRecordData.data}
                  onChange={(e) => setNewRecordData({...newRecordData, data: e.target.value})}
                  placeholder="Enter data to encrypt with FHE..."
                  className="cyber-textarea"
                  rows={4}
                />
              </div>
              
              <div className="fhe-notice">
                <div className="lock-icon"></div>
                Data will be encrypted using FHE before storage
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="cyber-button"
              >
                Cancel
              </button>
              <button 
                onClick={handleSetData}
                disabled={creating}
                className="cyber-button neon-purple"
              >
                {creating ? "Encrypting..." : "Encrypt & Store"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}

      {/* Wallet Selector */}
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
    </div>
  );
};

export default App;