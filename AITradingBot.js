// ai-enhanced-cow-trading-bot.js
import { ethers } from 'ethers';
import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
  // Required environment variables
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  BASE_RPC_URL: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  
  // CoW Protocol
  COW_API_BASE: "https://api.cow.fi/base/api/v1",
  
  // Token addresses on Base
  TOKENS: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  
  // Trading parameters
  CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutes
  ORDER_VALIDITY_HOURS: 24, // 24 hours
  MIN_PROFIT_MARGIN: 50, // $50 minimum profit
  MAX_POSITION_PERCENT: 0.8, // Max 80% in one asset
  MIN_ORDER_SIZE: 100, // $100 minimum order
};

class AIEnhancedTradingBot {
  constructor() {
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY);
    this.provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC_URL);
    this.connectedWallet = this.wallet.connect(this.provider);
    
    // State tracking
    this.currentPrice = null;
    this.costBasis = 0;
    this.ethHoldings = 0;
    this.totalCost = 0;
    this.priceHistory = [];
    this.priceHighWaterMark = 0;
    this.priceLowWaterMark = Infinity;
    this.lastFilledOrder = null;
    this.activeOrders = [];
    
    // AI models to try (in order of preference)
    this.aiModels = [
      'mistralai/mistral-7b-instruct',
      'meta-llama/llama-3.1-8b-instruct',
      'microsoft/DialoGPT-medium'
    ];
    this.currentModelIndex = 0;
    
    this.loadBotState();
    
    console.log(`🤖 AI-Enhanced CoW Trading Bot initialized`);
    console.log(`📋 Wallet: ${this.wallet.address}`);
  }

  // ===== DATA PERSISTENCE =====
  
  loadBotState() {
    try {
      if (fs.existsSync('ai-bot-state.json')) {
        const data = JSON.parse(fs.readFileSync('ai-bot-state.json', 'utf8'));
        this.costBasis = data.costBasis || 0;
        this.ethHoldings = data.ethHoldings || 0;
        this.totalCost = data.totalCost || 0;
        this.priceHistory = data.priceHistory || [];
        this.priceHighWaterMark = data.priceHighWaterMark || 0;
        this.priceLowWaterMark = data.priceLowWaterMark || Infinity;
        this.lastFilledOrder = data.lastFilledOrder || null;
        
        console.log(`📂 Loaded state: ${this.ethHoldings.toFixed(4)} ETH @ ${this.costBasis.toFixed(2)} avg`);
      } else {
        console.log(`📂 No saved state, will fetch from CoW API on startup`);
      }
    } catch (error) {
      console.log(`⚠️ Error loading state: ${error.message}`);
    }
  }
  
  saveState() {
    try {
      const data = {
        costBasis: this.costBasis,
        ethHoldings: this.ethHoldings,
        totalCost: this.totalCost,
        priceHistory: this.priceHistory.slice(-100), // Keep last 100 prices
        priceHighWaterMark: this.priceHighWaterMark,
        priceLowWaterMark: this.priceLowWaterMark,
        lastFilledOrder: this.lastFilledOrder,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync('ai-bot-state.json', JSON.stringify(data, null, 2));
    } catch (error) {
      console.log(`⚠️ Error saving state: ${error.message}`);
    }
  }

  // ===== PORTFOLIO ANALYSIS =====
  
  async getBalances() {
    try {
      const wethContract = new ethers.Contract(
        CONFIG.TOKENS.WETH,
        ['function balanceOf(address) view returns (uint256)'],
        this.provider
      );
      
      const usdcContract = new ethers.Contract(
        CONFIG.TOKENS.USDC,
        ['function balanceOf(address) view returns (uint256)'],
        this.provider
      );

      const [wethBalance, usdcBalance] = await Promise.all([
        wethContract.balanceOf(this.wallet.address),
        usdcContract.balanceOf(this.wallet.address)
      ]);

      return {
        wethAmount: parseFloat(ethers.formatEther(wethBalance)),
        usdcAmount: parseFloat(ethers.formatUnits(usdcBalance, 6))
      };
    } catch (error) {
      console.log(`❌ Balance error: ${error.message}`);
      return { wethAmount: 0, usdcAmount: 0 };
    }
  }

  // ===== TELEGRAM INTEGRATION =====
  
  async sendTelegramMessage(text) {
    if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
    
    try {
      await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.TELEGRAM_CHAT_ID,
          text: `${text}\n\n🕒 ${new Date().toLocaleString()}`,
          parse_mode: 'HTML'
        })
      });
    } catch (error) {
      console.log(`📱 Telegram error: ${error.message}`);
    }
  }

  // ===== STARTUP =====
  
  async start() {
    console.log(`🚀 Starting AI-Enhanced CoW Trading Bot`);
    console.log(`📋 Wallet: ${this.wallet.address}`);
    
    try {
      // Get actual wallet balance
      const actualBalances = await this.getBalances();
      console.log(`💰 Actual wallet balance: ${actualBalances.wethAmount.toFixed(4)} ETH, ${actualBalances.usdcAmount.toFixed(2)} USDC`);
      
      // Update holdings to match actual balance
      this.ethHoldings = actualBalances.wethAmount;
      
      // Send corrected Telegram notification
      await this.sendTelegramMessage(
        `📊 <b>AI Bot Started</b>\n` +
        `💎 ETH Holdings: ${this.ethHoldings.toFixed(4)}\n` +
        `💰 USDC Balance: ${actualBalances.usdcAmount.toFixed(2)}\n` +
        `📊 Cost Basis: ${this.costBasis.toFixed(2)}\n` +
        `✅ Synced with actual wallet balance`
      );
      
      this.saveState();
      console.log(`✅ Bot started successfully with corrected balance`);
      
    } catch (error) {
      console.error(`💥 Startup failed: ${error.message}`);
      await this.sendTelegramMessage(`💥 <b>Bot Startup Failed</b>\n${error.message}`);
      throw error;
    }
  }
  
  stop() {
    console.log(`⏹️ Stopping AI Trading Bot...`);
    this.saveState();
    
    console.log(`📊 Final State:`);
    console.log(`   ETH Holdings: ${this.ethHoldings.toFixed(4)}`);
    console.log(`   Cost Basis: ${this.costBasis.toFixed(2)}`);
    console.log(`   Total Cost: ${this.totalCost.toFixed(2)}`);
  }
}

// ===== MAIN EXECUTION =====

async function main() {
  // Validate required environment variables
  const required = ['PRIVATE_KEY', 'BASE_RPC_URL', 'OPENROUTER_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error(`📝 Please add them to your .env file:`);
    console.error(`PRIVATE_KEY=your_private_key`);
    console.error(`BASE_RPC_URL=https://mainnet.base.org`);
    console.error(`OPENROUTER_API_KEY=sk-or-v1-...`);
    console.error(`TELEGRAM_BOT_TOKEN=your_bot_token (optional)`);
    console.error(`TELEGRAM_CHAT_ID=your_chat_id (optional)`);
    process.exit(1);
  }
  
  const bot = new AIEnhancedTradingBot();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    bot.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n👋 Received SIGTERM, shutting down gracefully...');
    bot.stop();
    process.exit(0);
  });
  
  await bot.start();
}

// Run the bot
main().catch(error => {
  console.error(`💥 Fatal error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});

export default AIEnhancedTradingBot;