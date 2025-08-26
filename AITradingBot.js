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
        
        console.log(`📂 Loaded state: ${this.ethHoldings.toFixed(4)} ETH @ $${this.costBasis.toFixed(2)} avg`);
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

  // ===== COW API INTEGRATION =====
  
  async fetchRecentFilledOrders(limit = 20) {
    try {
      console.log(`📡 Fetching last ${limit} filled orders...`);
      console.log(`🔗 API URL: ${CONFIG.COW_API_BASE}/account/${this.wallet.address}/orders?limit=${limit}`);
      
      const response = await fetch(`${CONFIG.COW_API_BASE}/account/${this.wallet.address}/orders?limit=${limit}`);
      console.log(`📡 Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ CoW API Error Response: ${errorText}`);
        throw new Error(`CoW API Error: ${response.status} - ${errorText}`);
      }
      
      const orders = await response.json();
      console.log(`📋 Total orders returned: ${orders.length}`);
      
      if (orders.length > 0) {
        console.log(`🔍 Sample order structure:`, JSON.stringify(orders[0], null, 2));
      }
      
      // Filter to filled WETH/USDC orders
      const filledOrders = orders.filter(order => {
        const isWethUsdc = (
          (order.sellToken.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase() && 
           order.buyToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase()) ||
          (order.sellToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase() && 
           order.buyToken.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase())
        );
        const isFilled = order.status === 'fulfilled';
        
        console.log(`📊 Order ${order.uid?.slice(0,8)}... - Status: ${order.status}, WETH/USDC: ${isWethUsdc}`);
        
        return isFilled && isWethUsdc;
      });
      
      console.log(`📊 Found ${filledOrders.length} filled WETH/USDC orders`);
      
      // Send Telegram message about what we found
      await this.sendTelegramMessage(
        `📊 <b>CoW Orders Check</b>\n\n` +
        `📡 Total orders: ${orders.length}\n` +
        `✅ Filled WETH/USDC: ${filledOrders.length}\n` +
        `🔗 API: ${CONFIG.COW_API_BASE.includes('base') ? 'Base Network' : 'Mainnet'}`
      );
      
      return filledOrders;
      
    } catch (error) {
      console.log(`❌ Error fetching orders: ${error.message}`);
      
      // Send error to Telegram
      await this.sendTelegramMessage(
        `❌ <b>CoW API Error</b>\n\n` +
        `${error.message}\n\n` +
        `💡 This might mean:\n` +
        `• No CoW trades on this network\n` +
        `• API endpoint issue\n` +
        `• Network connectivity problem`
      );
      
      return [];
    }
  }
  
  async fetchActiveOrders() {
    try {
      const response = await fetch(`${CONFIG.COW_API_BASE}/account/${this.wallet.address}/orders?limit=50`);
      if (!response.ok) {
        throw new Error(`CoW API Error: ${response.status}`);
      }
      
      const orders = await response.json();
      
      // Filter to active WETH/USDC orders
      const activeOrders = orders.filter(order => {
        const isWethUsdc = (
          (order.sellToken.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase() && 
           order.buyToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase()) ||
          (order.sellToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase() && 
           order.buyToken.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase())
        );
        return order.status === 'open' && isWethUsdc;
      });
      
      this.activeOrders = activeOrders;
      return activeOrders;
      
    } catch (error) {
      console.log(`❌ Error fetching active orders: ${error.message}`);
      return [];
    }
  }

  // ===== COST BASIS CALCULATION =====
  
  parseFilledOrder(order) {
    const isBuy = order.sellToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase();
    
    try {
      let ethAmount, usdcAmount, executionPrice;
      
      if (isBuy) {
        usdcAmount = parseFloat(ethers.formatUnits(order.sellAmount, 6));
        ethAmount = parseFloat(ethers.formatEther(order.buyAmount));
        
        if (order.executedSellAmount && order.executedBuyAmount) {
          const executedUsdcAmount = parseFloat(ethers.formatUnits(order.executedSellAmount, 6));
          const executedEthAmount = parseFloat(ethers.formatEther(order.executedBuyAmount));
          executionPrice = executedUsdcAmount / executedEthAmount;
          ethAmount = executedEthAmount;
          usdcAmount = executedUsdcAmount;
        } else {
          executionPrice = usdcAmount / ethAmount;
        }
      } else {
        ethAmount = parseFloat(ethers.formatEther(order.sellAmount));
        usdcAmount = parseFloat(ethers.formatUnits(order.buyAmount, 6));
        
        if (order.executedSellAmount && order.executedBuyAmount) {
          const executedEthAmount = parseFloat(ethers.formatEther(order.executedSellAmount));
          const executedUsdcAmount = parseFloat(ethers.formatUnits(order.executedBuyAmount, 6));
          executionPrice = executedUsdcAmount / executedEthAmount;
          ethAmount = executedEthAmount;
          usdcAmount = executedUsdcAmount;
        } else {
          executionPrice = usdcAmount / ethAmount;
        }
      }
      
      return {
        type: isBuy ? 'BUY' : 'SELL',
        ethAmount,
        usdcAmount,
        executionPrice,
        date: new Date(order.creationDate),
        orderId: order.uid
      };
      
    } catch (error) {
      console.log(`❌ Error parsing order: ${error.message}`);
      return null;
    }
  }
  
  calculateCostBasisFromOrders(filledOrders) {
    console.log(`🧮 Calculating cost basis from ${filledOrders.length} orders...`);
    
    let ethHoldings = 0;
    let totalCost = 0;
    let lastOrder = null;
    
    // Sort chronologically
    const sortedOrders = filledOrders
      .map(order => this.parseFilledOrder(order))
      .filter(order => order !== null)
      .sort((a, b) => a.date - b.date);
    
    for (const order of sortedOrders) {
      if (order.type === 'BUY') {
        ethHoldings += order.ethAmount;
        totalCost += order.usdcAmount;
        console.log(`  📈 BUY: +${order.ethAmount.toFixed(4)} ETH at $${order.executionPrice.toFixed(2)}`);
      } else {
        const sellAmount = Math.min(order.ethAmount, ethHoldings);
        if (ethHoldings > 0) {
          const avgCost = totalCost / ethHoldings;
          const costToRemove = sellAmount * avgCost;
          totalCost -= costToRemove;
          ethHoldings -= sellAmount;
          console.log(`  📉 SELL: -${sellAmount.toFixed(4)} ETH at $${order.executionPrice.toFixed(2)} (was $${avgCost.toFixed(2)})`);
        }
      }
      lastOrder = order;
    }
    
    const costBasis = ethHoldings > 0 ? totalCost / ethHoldings : 0;
    
    this.ethHoldings = ethHoldings;
    this.totalCost = totalCost;
    this.costBasis = costBasis;
    this.lastFilledOrder = lastOrder;
    
    console.log(`📊 Final: ${ethHoldings.toFixed(4)} ETH @ $${costBasis.toFixed(2)} avg cost`);
    console.log(`💰 Total cost basis: $${totalCost.toFixed(2)}`);
    
    return { ethHoldings, totalCost, costBasis };
  }

  // ===== PRICE FETCHING =====
  
  async getCurrentPrice() {
    const sources = [
      {
        name: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        parse: (data) => data.ethereum.usd
      },
      {
        name: 'Binance',
        url: 'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT',
        parse: (data) => parseFloat(data.price)
      }
    ];
    
    for (const source of sources) {
      try {
        const response = await fetch(source.url, { timeout: 10000 });
        if (!response.ok) continue;
        
        const data = await response.json();
        const price = source.parse(data);
        
        if (price && price > 0) {
          this.currentPrice = price;
          this.priceHistory.push({ price, timestamp: Date.now() });
          
          // Keep last 200 price points
          if (this.priceHistory.length > 200) {
            this.priceHistory = this.priceHistory.slice(-200);
          }
          
          // Update water marks
          this.priceHighWaterMark = Math.max(this.priceHighWaterMark, price);
          this.priceLowWaterMark = Math.min(this.priceLowWaterMark, price);
          
          console.log(`💱 ETH: $${price.toFixed(2)} (${source.name})`);
          return price;
        }
      } catch (error) {
        console.log(`⚠️ ${source.name} failed: ${error.message}`);
      }
    }
    
    throw new Error('All price sources failed');
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
  
  async getPortfolioState() {
    const balances = await this.getBalances();
    const totalValue = (balances.wethAmount * this.currentPrice) + balances.usdcAmount;
    
    return {
      ...balances,
      totalValue,
      ethPercent: totalValue > 0 ? (balances.wethAmount * this.currentPrice) / totalValue : 0,
      usdcPercent: totalValue > 0 ? balances.usdcAmount / totalValue : 0
    };
  }

  // ===== AI INTEGRATION =====
  
  async askAI(context) {
    const systemPrompt = `You are a cryptocurrency trading assistant for ETH/USDC pairs on CoW Protocol.

Key Rules:
- NEVER recommend selling below cost basis + minimum profit ($${CONFIG.MIN_PROFIT_MARGIN})
- Consider portfolio balance (avoid being >80% in one asset)
- Factor in recent price trends and volatility
- CoW Protocol limit orders take time to fill, plan accordingly
- Profit targets should be $100-200 range
- Be conservative with position sizes

Analyze the market data and return JSON ONLY with this structure:
{
  "action": "WAIT" | "BUY" | "SELL" | "CANCEL_ORDERS",
  "reasoning": "explain your decision in 1-2 sentences",
  "confidence": 0.1-1.0,
  "parameters": {
    "buyPrice": number,
    "sellPrice": number,
    "orderSize": number,
    "urgency": "LOW" | "MEDIUM" | "HIGH"
  },
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}`;

    for (let attempt = 0; attempt < this.aiModels.length; attempt++) {
      try {
        const model = this.aiModels[this.currentModelIndex];
        console.log(`🤖 Asking AI (${model})...`);
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/your-repo',
            'X-Title': 'CoW Trading Bot'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: JSON.stringify(context, null, 2) }
            ],
            temperature: 0.3,
            max_tokens: 500
          }),
          timeout: 15000
        });
        
        if (!response.ok) {
          throw new Error(`AI API Error: ${response.status}`);
        }
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content.trim();
        
        // Parse JSON response
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in AI response');
        }
        
        const decision = JSON.parse(jsonMatch[0]);
        
        console.log(`🤖 AI Decision: ${decision.action} (confidence: ${decision.confidence})`);
        console.log(`🤖 Reasoning: ${decision.reasoning}`);
        
        return decision;
        
      } catch (error) {
        console.log(`❌ AI attempt ${attempt + 1} failed: ${error.message}`);
        
        // Try next model
        this.currentModelIndex = (this.currentModelIndex + 1) % this.aiModels.length;
        
        if (attempt === this.aiModels.length - 1) {
          console.log(`❌ All AI models failed, using fallback logic`);
          return this.getFallbackDecision(context);
        }
      }
    }
  }
  
  getFallbackDecision(context) {
    console.log(`🔄 Using fallback decision logic`);
    
    const { currentPrice, costBasis, portfolioETH, portfolioUSDC } = context;
    const totalValue = (portfolioETH * currentPrice) + portfolioUSDC;
    const ethPercent = totalValue > 0 ? (portfolioETH * currentPrice) / totalValue : 0;
    
    // Simple fallback rules
    if (currentPrice < costBasis + CONFIG.MIN_PROFIT_MARGIN) {
      return {
        action: "WAIT",
        reasoning: "Price below profitable sell threshold, waiting",
        confidence: 0.8,
        parameters: { urgency: "LOW" },
        riskLevel: "LOW"
      };
    }
    
    if (ethPercent > 0.8) {
      return {
        action: "SELL",
        reasoning: "Portfolio heavily ETH weighted, rebalancing",
        confidence: 0.7,
        parameters: {
          sellPrice: currentPrice + 50,
          orderSize: portfolioETH * 0.3,
          urgency: "MEDIUM"
        },
        riskLevel: "MEDIUM"
      };
    }
    
    if (ethPercent < 0.3) {
      return {
        action: "BUY",
        reasoning: "Portfolio heavily USDC weighted, buying dip",
        confidence: 0.7,
        parameters: {
          buyPrice: currentPrice - 50,
          orderSize: Math.min(500, portfolioUSDC * 0.3),
          urgency: "MEDIUM"
        },
        riskLevel: "MEDIUM"
      };
    }
    
    return {
      action: "WAIT",
      reasoning: "Portfolio balanced, no action needed",
      confidence: 0.6,
      parameters: { urgency: "LOW" },
      riskLevel: "LOW"
    };
  }

  // ===== ORDER EXECUTION =====
  
  async placeBuyOrder(price, usdcAmount) {
    try {
      console.log(`🟢 Placing BUY: $${usdcAmount} at $${price.toFixed(2)}`);
      
      const ethAmount = usdcAmount / price;
      const sellAmount = ethers.parseUnits(usdcAmount.toFixed(6), 6);
      const buyAmount = ethers.parseEther(ethAmount.toFixed(18));
      const validTo = Math.floor(Date.now() / 1000) + (CONFIG.ORDER_VALIDITY_HOURS * 60 * 60);
      
      const order = {
        sellToken: CONFIG.TOKENS.USDC,
        buyToken: CONFIG.TOKENS.WETH,
        receiver: this.wallet.address,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        validTo,
        appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
        feeAmount: "0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20"
      };

      const signature = await this.signOrder(order);
      const orderId = await this.submitOrder(order, signature);
      
      console.log(`✅ BUY order placed: ${orderId.slice(0, 10)}...`);
      await this.sendTelegramMessage(`🟢 BUY Order Placed\n💰 $${usdcAmount} → ${ethAmount.toFixed(4)} ETH\n📊 Price: $${price.toFixed(2)}`);
      
      return orderId;
      
    } catch (error) {
      console.log(`❌ Buy order failed: ${error.message}`);
      await this.sendTelegramMessage(`❌ BUY Order Failed: ${error.message}`);
      throw error;
    }
  }
  
  async placeSellOrder(price, ethAmount) {
    try {
      console.log(`🔴 Placing SELL: ${ethAmount.toFixed(4)} ETH at $${price.toFixed(2)}`);
      
      const usdcAmount = ethAmount * price;
      const sellAmount = ethers.parseEther(ethAmount.toFixed(18));
      const buyAmount = ethers.parseUnits(usdcAmount.toFixed(6), 6);
      const validTo = Math.floor(Date.now() / 1000) + (CONFIG.ORDER_VALIDITY_HOURS * 60 * 60);
      
      const order = {
        sellToken: CONFIG.TOKENS.WETH,
        buyToken: CONFIG.TOKENS.USDC,
        receiver: this.wallet.address,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
        validTo,
        appData: "0x0000000000000000000000000000000000000000000000000000000000000000",
        feeAmount: "0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20"
      };

      const signature = await this.signOrder(order);
      const orderId = await this.submitOrder(order, signature);
      
      console.log(`✅ SELL order placed: ${orderId.slice(0, 10)}...`);
      await this.sendTelegramMessage(`🔴 SELL Order Placed\n💎 ${ethAmount.toFixed(4)} ETH → $${usdcAmount.toFixed(2)}\n📊 Price: $${price.toFixed(2)}`);
      
      return orderId;
      
    } catch (error) {
      console.log(`❌ Sell order failed: ${error.message}`);
      await this.sendTelegramMessage(`❌ SELL Order Failed: ${error.message}`);
      throw error;
    }
  }
  
  async signOrder(order) {
    const domain = {
      name: "Gnosis Protocol",
      version: "v2",
      chainId: 8453,
      verifyingContract: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
    };

    const types = {
      Order: [
        { name: "sellToken", type: "address" },
        { name: "buyToken", type: "address" },
        { name: "receiver", type: "address" },
        { name: "sellAmount", type: "uint256" },
        { name: "buyAmount", type: "uint256" },
        { name: "validTo", type: "uint32" },
        { name: "appData", type: "bytes32" },
        { name: "feeAmount", type: "uint256" },
        { name: "kind", type: "string" },
        { name: "partiallyFillable", type: "bool" },
        { name: "sellTokenBalance", type: "string" },
        { name: "buyTokenBalance", type: "string" }
      ]
    };

    return await this.connectedWallet.signTypedData(domain, types, order);
  }
  
  async submitOrder(order, signature) {
    const response = await fetch(`${CONFIG.COW_API_BASE}/orders`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'AITradingBot/1.0'
      },
      body: JSON.stringify({ ...order, signature, signingScheme: "eip712" }),
      timeout: 15000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Order submission failed: ${response.status} - ${errorText}`);
    }

    const result = await response.text();
    return result.replace(/"/g, '');
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

  // ===== SAFETY CHECKS =====
  
  applySafetyFilters(aiDecision, context) {
    const { action, parameters } = aiDecision;
    const { currentPrice, costBasis, portfolioETH, portfolioUSDC } = context;
    
    // Never sell below cost basis + minimum profit
    if (action === 'SELL' && parameters.sellPrice < costBasis + CONFIG.MIN_PROFIT_MARGIN) {
      console.log(`🛡️ Safety: Blocked sell below profitable price`);
      return { ...aiDecision, action: 'WAIT', reasoning: 'Safety: Price below profitable threshold' };
    }
    
    // Don't buy if already heavily ETH weighted
    const totalValue = (portfolioETH * currentPrice) + portfolioUSDC;
    const ethPercent = totalValue > 0 ? (portfolioETH * currentPrice) / totalValue : 0;
    
    if (action === 'BUY' && ethPercent > CONFIG.MAX_POSITION_PERCENT) {
      console.log(`🛡️ Safety: Blocked buy, already ${(ethPercent*100).toFixed(1)}% ETH`);
      return { ...aiDecision, action: 'WAIT', reasoning: 'Safety: Already heavily ETH weighted' };
    }
    
    if (action === 'SELL' && (1 - ethPercent) > CONFIG.MAX_POSITION_PERCENT) {
      console.log(`🛡️ Safety: Blocked sell, already ${((1-ethPercent)*100).toFixed(1)}% USDC`);
      return { ...aiDecision, action: 'WAIT', reasoning: 'Safety: Already heavily USDC weighted' };
    }
    
    // Minimum order size check
    if ((action === 'BUY' && parameters.orderSize < CONFIG.MIN_ORDER_SIZE) ||
        (action === 'SELL' && parameters.orderSize * currentPrice < CONFIG.MIN_ORDER_SIZE)) {
      console.log(`🛡️ Safety: Order too small`);
      return { ...aiDecision, action: 'WAIT', reasoning: 'Safety: Order size below minimum' };
    }
    
    return aiDecision;
  }

  // ===== MAIN LOOP =====
  
  async checkForNewFills() {
    try {
      const filledOrders = await this.fetchRecentFilledOrders(5);
      
      for (const order of filledOrders) {
        const parsed = this.parseFilledOrder(order);
        if (!parsed) continue;
        
        // Check if this is a new fill
        if (!this.lastFilledOrder || parsed.orderId !== this.lastFilledOrder.orderId) {
          console.log(`🎯 NEW FILL: ${parsed.type} ${parsed.ethAmount.toFixed(4)} ETH at $${parsed.executionPrice.toFixed(2)}`);
          
          // Update cost basis
          if (parsed.type === 'BUY') {
            this.ethHoldings += parsed.ethAmount;
            this.totalCost += parsed.usdcAmount;
            this.costBasis = this.totalCost / this.ethHoldings;
          } else {
            const sellAmount = Math.min(parsed.ethAmount, this.ethHoldings);
            if (this.ethHoldings > 0) {
              const costToRemove = sellAmount * this.costBasis;
              this.totalCost -= costToRemove;
              this.ethHoldings -= sellAmount;
              this.costBasis = this.ethHoldings > 0 ? this.totalCost / this.ethHoldings : 0;
            }
          }
          
          this.lastFilledOrder = parsed;
          this.saveState();
          
          // Send Telegram notification
          const profit = parsed.type === 'SELL' ? 
            (parsed.executionPrice - this.costBasis) * parsed.ethAmount : 
            0;
            
          await this.sendTelegramMessage(
            `✅ <b>${parsed.type} FILLED</b>\n` +
            `💰 ${parsed.ethAmount.toFixed(4)} ETH at ${parsed.executionPrice.toFixed(2)}\n` +
            `📊 Cost Basis: ${this.costBasis.toFixed(2)}\n` +
            `💎 Holdings: ${this.ethHoldings.toFixed(4)} ETH\n` +
            (profit > 0 ? `🎉 Profit: ${profit.toFixed(2)}` : '')
          );
          
          return true; // New fill detected
        }
      }
      
      return false; // No new fills
    } catch (error) {
      console.log(`❌ Error checking fills: ${error.message}`);
      return false;
    }
  }
  
  async runCycle() {
    console.log(`\n🤖 === AI Trading Cycle - ${new Date().toLocaleTimeString()} ===`);
    
    try {
      // 1. Update current price
      await this.getCurrentPrice();
      
      // 2. Check for new filled orders
      const newFills = await this.checkForNewFills();
      if (newFills) {
        console.log(`🎯 Detected new fills, updated cost basis`);
      }
      
      // 3. Get current portfolio state
      const portfolio = await this.getPortfolioState();
      
      // 4. Fetch active orders
      await this.fetchActiveOrders();
      
      // 5. Prepare context for AI
      const context = {
        currentPrice: this.currentPrice,
        costBasis: this.costBasis,
        portfolioETH: portfolio.wethAmount,
        portfolioUSDC: portfolio.usdcAmount,
        totalValue: portfolio.totalValue,
        ethPercent: portfolio.ethPercent,
        priceHistory24h: this.priceHistory.slice(-48).map(p => p.price), // Last 4 hours
        lastFilledOrder: this.lastFilledOrder,
        activeOrders: this.activeOrders.length,
        priceHighWaterMark: this.priceHighWaterMark,
        priceLowWaterMark: this.priceLowWaterMark,
        ethHoldings: this.ethHoldings,
        totalCost: this.totalCost
      };
      
      console.log(`📊 Portfolio: ${portfolio.wethAmount.toFixed(4)} ETH + ${portfolio.usdcAmount.toFixed(2)} USDC`);
      console.log(`📊 Cost Basis: ${this.costBasis.toFixed(2)} | Current: ${this.currentPrice.toFixed(2)}`);
      console.log(`📊 Balance: ${(portfolio.ethPercent * 100).toFixed(1)}% ETH, ${(portfolio.usdcPercent * 100).toFixed(1)}% USDC`);
      
      // 6. Get AI decision
      const aiDecision = await this.askAI(context);
      
      // 7. Apply safety filters
      const safeDecision = this.applySafetyFilters(aiDecision, context);
      
      // 8. Execute decision
      await this.executeDecision(safeDecision, portfolio);
      
    } catch (error) {
      console.log(`❌ Cycle error: ${error.message}`);
      await this.sendTelegramMessage(`❌ Bot Error: ${error.message}`);
    }
    
    console.log(`🤖 === Cycle Complete ===\n`);
  }
  
  async executeDecision(decision, portfolio) {
    const { action, parameters, reasoning } = decision;
    
    console.log(`🎯 Executing: ${action}`);
    console.log(`🤔 Reasoning: ${reasoning}`);
    
    switch (action) {
      case 'BUY':
        if (parameters.buyPrice && parameters.orderSize) {
          // Check if we have enough USDC
          if (portfolio.usdcAmount >= parameters.orderSize + 50) {
            await this.placeBuyOrder(parameters.buyPrice, parameters.orderSize);
          } else {
            console.log(`❌ Insufficient USDC: ${portfolio.usdcAmount.toFixed(2)} < ${parameters.orderSize + 50}`);
          }
        }
        break;
        
      case 'SELL':
        if (parameters.sellPrice && parameters.orderSize) {
          // Check if we have enough ETH
          const ethNeeded = parameters.orderSize / this.currentPrice;
          if (portfolio.wethAmount >= ethNeeded + 0.001) {
            await this.placeSellOrder(parameters.sellPrice, ethNeeded);
          } else {
            console.log(`❌ Insufficient ETH: ${portfolio.wethAmount.toFixed(4)} < ${ethNeeded.toFixed(4)}`);
          }
        }
        break;
        
      case 'WAIT':
        console.log(`⏳ Waiting: ${reasoning}`);
        break;
        
      case 'CANCEL_ORDERS':
        console.log(`🚫 Would cancel orders (not implemented yet)`);
        break;
        
      default:
        console.log(`❓ Unknown action: ${action}`);
    }
  }
  
  async initializeFromHistory() {
    console.log(`🔍 Initializing from trading history...`);
    
    const filledOrders = await this.fetchRecentFilledOrders(50);
    if (filledOrders.length > 0) {
      this.calculateCostBasisFromOrders(filledOrders);
      this.saveState();
      
      await this.sendTelegramMessage(
        `📊 <b>Bot Initialized</b>\n` +
        `💎 ETH Holdings: ${this.ethHoldings.toFixed(4)}\n` +
        `📊 Cost Basis: ${this.costBasis.toFixed(2)}\n` +
        `💰 Total Cost: ${this.totalCost.toFixed(2)}\n` +
        `📈 From ${filledOrders.length} recent trades`
      );
    } else {
      console.log(`⚠️ No trading history found, starting fresh`);
      await this.sendTelegramMessage(`🆕 <b>Bot Started Fresh</b>\nNo previous trading history found.`);
    }
  }

  // ===== STARTUP =====
  
  async start() {
    console.log(`🚀 Starting AI-Enhanced CoW Trading Bot`);
    console.log(`🤖 AI Models: ${this.aiModels.join(', ')}`);
    console.log(`📋 Wallet: ${this.wallet.address}`);
    console.log(`⏰ Check interval: ${CONFIG.CHECK_INTERVAL / 60000} minutes`);
    
    try {
      // Initialize from history if no saved state
      if (this.ethHoldings === 0 && this.costBasis === 0) {
        await this.initializeFromHistory();
      }
      
      // Get initial price
      await this.getCurrentPrice();
      
      console.log(`✅ Bot started successfully`);
      
      // Run immediately
      await this.runCycle();
      
      // Then run every 5 minutes
      setInterval(async () => {
        try {
          await this.runCycle();
        } catch (error) {
          console.log(`❌ Cycle error: ${error.message}`);
        }
      }, CONFIG.CHECK_INTERVAL);
      
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

// Run only if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`💥 Fatal error: ${error.message}`);
    process.exit(1);
  });
}

export default AIEnhancedTradingBot;