// enhanced-ai-trading-bot.js - Complete version with Conversational Telegram AI
import { ethers } from 'ethers';
import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

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
  DUPLICATE_ORDER_THRESHOLD: 10, // $10 price difference to avoid duplicates
};

class ConversationalAITradingBot {
  constructor() {
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY);
    this.provider = new ethers.JsonRpcProvider(CONFIG.BASE_RPC_URL);
    this.connectedWallet = this.wallet.connect(this.provider);

    // Initialize Telegram Bot
    this.telegramBot = null;
    if (CONFIG.TELEGRAM_BOT_TOKEN) {
      this.telegramBot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
      this.setupTelegramHandlers();
    }

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
    this.processedOrderIds = new Set();
    this.conversationHistory = [];
    this.lastAIReasoning = null;

    // AI models to try (in order of preference) - FREE MODELS
    this.aiModels = [
      'mistralai/mistral-7b-instruct:free',
      'huggingface/meta-llama/Meta-Llama-3-8B-Instruct',
      'microsoft/DialoGPT-medium'
    ];
    this.currentModelIndex = 0;

    this.loadBotState();

    console.log(`🤖 Enhanced Conversational AI Trading Bot initialized`);
    console.log(`📋 Wallet: ${this.wallet.address}`);
  }

  // ===== TELEGRAM SETUP =====

  setupTelegramHandlers() {
    console.log(`📱 Setting up Telegram handlers...`);

    // Command handlers
    this.telegramBot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.telegramBot.onText(/\/status/, (msg) => this.handleStatus(msg));
    this.telegramBot.onText(/\/orders/, (msg) => this.handleOrders(msg));
    this.telegramBot.onText(/\/active/, (msg) => this.handleActiveOrders(msg));
    this.telegramBot.onText(/\/history/, (msg) => this.handleHistory(msg));
    this.telegramBot.onText(/\/force/, (msg) => this.handleForceAnalysis(msg));
    this.telegramBot.onText(/\/help/, (msg) => this.handleHelp(msg));

    // Handle regular messages (conversation with AI)
    this.telegramBot.on('message', (msg) => {
      // Skip if it's a command
      if (msg.text && msg.text.startsWith('/')) return;

      // Only respond to messages from the configured chat ID
      if (CONFIG.TELEGRAM_CHAT_ID && msg.chat.id.toString() !== CONFIG.TELEGRAM_CHAT_ID.toString()) {
        return;
      }

      this.handleConversation(msg);
    });

    console.log(`✅ Telegram bot ready for commands and conversations`);
  }

  async handleStart(msg) {
    const welcomeMessage = `🤖 <b>Enhanced AI Trading Bot</b>
    
🎯 <b>Features:</b>
• AI-powered trading decisions
• Real-time portfolio monitoring
• Conversational AI assistant
• Smart order management

💬 <b>Commands:</b>
/status - Portfolio & bot status
/orders - Last 10 filled orders
/active - Current open orders
/history - Extended trade history
/force - Force AI analysis
/help - Show this help

💡 <b>Chat with AI:</b>
Just type your questions! I can discuss:
• Market analysis & strategy
• Portfolio recommendations
• Trade explanations
• Risk assessments

<i>Ready to trade smarter! 🚀</i>`;

    await this.sendTelegramMessage(welcomeMessage);

    // Show current status
    await this.handleStatus(msg);
  }

  async handleStatus(msg) {
    try {
      await this.getCurrentPrice();
      const portfolio = await this.getPortfolioState();
      const unrealizedPnL = this.ethHoldings > 0 ?
        (this.currentPrice - this.costBasis) * this.ethHoldings : 0;

      const statusMessage = `📊 <b>Bot Status</b>

💰 <b>Portfolio:</b>
• ${portfolio.wethAmount.toFixed(4)} WETH (${(portfolio.ethPercent * 100).toFixed(1)}%)
• $${portfolio.usdcAmount.toFixed(2)} USDC (${(portfolio.usdcPercent * 100).toFixed(1)}%)
• Total Value: $${portfolio.totalValue.toFixed(2)}

📈 <b>Performance:</b>
• Cost Basis: $${this.costBasis.toFixed(2)}
• Current Price: $${this.currentPrice.toFixed(2)}
• Unrealized P&L: $${unrealizedPnL.toFixed(2)}

🎯 <b>Active Orders:</b> ${this.activeOrders.length}

🤖 <b>Last AI Decision:</b>
${this.lastAIReasoning || 'No recent analysis'}

<i>Bot running normally ✅</i>`;

      await this.sendTelegramMessage(statusMessage);
    } catch (error) {
      await this.sendTelegramMessage(`❌ Error getting status: ${error.message}`);
    }
  }

  async handleOrders(msg) {
    try {
      const filledOrders = await this.fetchRecentFilledOrders(10);

      if (filledOrders.length === 0) {
        await this.sendTelegramMessage(`📋 <b>No Recent Filled Orders</b>

No WETH/USDC trades found in recent history.`);
        return;
      }

      let ordersMessage = `📋 <b>Last ${filledOrders.length} Filled Orders</b>\n\n`;

      for (let i = 0; i < filledOrders.length; i++) {
        const order = this.parseFilledOrder(filledOrders[i]);
        if (!order) continue;

        const profit = order.type === 'SELL' && this.costBasis > 0 ?
          (order.executionPrice - this.costBasis) * order.ethAmount : 0;

        const profitEmoji = profit > 0 ? '🟢' : profit < 0 ? '🔴' : '⚪';
        const profitText = profit !== 0 ? ` (${profitEmoji}$${profit.toFixed(2)})` : '';

        ordersMessage += `${i + 1}. <b>${order.type}</b> ${order.ethAmount.toFixed(4)} ETH\n`;
        ordersMessage += `   💰 $${order.executionPrice.toFixed(2)}${profitText}\n`;
        ordersMessage += `   📅 ${order.date.toLocaleDateString()}\n\n`;
      }

      await this.sendTelegramMessage(ordersMessage);
    } catch (error) {
      await this.sendTelegramMessage(`❌ Error fetching orders: ${error.message}`);
    }
  }

  async handleActiveOrders(msg) {
    try {
      await this.fetchActiveOrders();

      if (this.activeOrders.length === 0) {
        await this.sendTelegramMessage(`📋 <b>No Active Orders</b>

No open WETH/USDC orders found.`);
        return;
      }

      let activeMessage = `🔄 <b>${this.activeOrders.length} Active Orders</b>\n\n`;

      for (let i = 0; i < this.activeOrders.length; i++) {
        const order = this.parseActiveOrder(this.activeOrders[i]);
        if (!order) continue;

        const distanceFromMarket = this.currentPrice ?
          Math.abs(order.price - this.currentPrice) : 0;

        activeMessage += `${i + 1}. <b>${order.type}</b> ${order.ethAmount.toFixed(4)} ETH\n`;
        activeMessage += `   💰 $${order.price.toFixed(2)} (±$${distanceFromMarket.toFixed(0)} from market)\n`;
        activeMessage += `   🆔 ${order.orderId.slice(0, 8)}...\n\n`;
      }

      await this.sendTelegramMessage(activeMessage);
    } catch (error) {
      await this.sendTelegramMessage(`❌ Error fetching active orders: ${error.message}`);
    }
  }

  async handleHistory(msg) {
    try {
      const filledOrders = await this.fetchRecentFilledOrders(50);
      const { totalProfit, totalBuys, totalSells, totalVolume } = this.calculateTradeStats(filledOrders);

      const historyMessage = `📈 <b>Trading History (50 orders)</b>

📊 <b>Summary:</b>
• Total Trades: ${totalBuys + totalSells} (${totalBuys}B/${totalSells}S)
• Total Volume: $${totalVolume.toFixed(2)}
• Estimated Profit: $${totalProfit.toFixed(2)}

💎 <b>Current Holdings:</b>
• ${this.ethHoldings.toFixed(4)} ETH @ $${this.costBasis.toFixed(2)} avg
• Total Cost: $${this.totalCost.toFixed(2)}

🎯 Use /orders for detailed recent trades`;

      await this.sendTelegramMessage(historyMessage);
    } catch (error) {
      await this.sendTelegramMessage(`❌ Error getting history: ${error.message}`);
    }
  }

  async handleForceAnalysis(msg) {
    await this.sendTelegramMessage(`🔄 <b>Forcing AI Analysis...</b>\n\nAnalyzing market conditions and portfolio...`);

    try {
      await this.runCycle();
      await this.sendTelegramMessage(`✅ <b>Forced Analysis Complete</b>\n\n${this.lastAIReasoning || 'Analysis completed successfully'}`);
    } catch (error) {
      await this.sendTelegramMessage(`❌ Forced analysis failed: ${error.message}`);
    }
  }

  async handleHelp(msg) {
    const helpMessage = `🤖 <b>AI Trading Bot Help</b>

💬 <b>Commands:</b>
/status - Portfolio & performance
/orders - Last 10 filled trades
/active - Current open orders  
/history - Extended trade history
/force - Force AI market analysis
/help - Show this help

🗣️ <b>Chat with AI:</b>
Just type your questions! Examples:

"Why are you waiting to trade?"
"Should I sell my ETH now?"
"What's your strategy?"
"Explain the current market"
"How's my portfolio risk?"

🎯 <b>AI Features:</b>
• Explains all trading decisions
• Provides market analysis
• Discusses strategy options
• Warns about risks
• Educational responses

💡 The AI knows your exact portfolio, cost basis, and market conditions for personalized advice!`;

    await this.sendTelegramMessage(helpMessage);
  }

  async handleConversation(msg) {
    if (!msg.text || msg.text.trim().length === 0) return;

    try {
      // Show typing indicator
      await this.telegramBot.sendChatAction(msg.chat.id, 'typing');

      console.log(`💬 User message: ${msg.text}`);

      // Get current context for AI
      await this.getCurrentPrice();
      const portfolio = await this.getPortfolioState();
      await this.fetchActiveOrders();

      const context = {
        userMessage: msg.text,
        currentPrice: this.currentPrice,
        costBasis: this.costBasis,
        portfolioETH: portfolio.wethAmount,
        portfolioUSDC: portfolio.usdcAmount,
        totalValue: portfolio.totalValue,
        ethPercent: portfolio.ethPercent,
        ethHoldings: this.ethHoldings,
        totalCost: this.totalCost,
        activeOrders: this.activeOrders.length,
        lastAIReasoning: this.lastAIReasoning,
        conversationHistory: this.conversationHistory.slice(-6), // Last 3 exchanges
        priceHighWaterMark: this.priceHighWaterMark,
        priceLowWaterMark: this.priceLowWaterMark
      };

      const aiResponse = await this.askConversationalAI(context);

      // Store conversation
      this.conversationHistory.push({
        user: msg.text,
        ai: aiResponse,
        timestamp: Date.now()
      });

      // Keep conversation history manageable
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-10);
      }

      await this.sendTelegramMessage(`🤖 ${aiResponse}`);

    } catch (error) {
      console.log(`❌ Conversation error: ${error.message}`);
      await this.sendTelegramMessage(`❌ I'm having trouble processing that. Could you try rephrasing your question?`);
    }
  }

  // ===== CONVERSATIONAL AI =====

  async askConversationalAI(context) {
    const systemPrompt = `You are a helpful cryptocurrency trading assistant. You have access to the user's complete portfolio and trading history on CoW Protocol (Base network) for ETH/USDC trades.

PERSONALITY: Be brief and direct. Keep responses under 3 sentences. Use simple language. Add one emoji max.

CURRENT CONTEXT:
- User's Portfolio: ${context.portfolioETH.toFixed(4)} ETH + $${context.portfolioUSDC.toFixed(2)} USDC
- ETH Cost Basis: $${context.costBasis.toFixed(2)}
- Current ETH Price: $${context.currentPrice.toFixed(2)}
- Portfolio Balance: ${(context.ethPercent * 100).toFixed(1)}% ETH, ${((1 - context.ethPercent) * 100).toFixed(1)}% USDC
- Active Orders: ${context.activeOrders}
- Recent AI Reasoning: ${context.lastAIReasoning || 'None'}

GUIDELINES:
- Always consider the user's actual portfolio and market conditions
- Explain trading decisions in simple terms
- Warn about risks appropriately
- If asked about trades, consider their cost basis and current prices
- Don't give financial advice, but explain analysis and considerations
- Be educational about trading concepts
- Reference their actual data when relevant

USER MESSAGE: "${context.userMessage}"

Respond naturally as if you're chatting with a friend about their portfolio. Keep it conversational but informative.`;

    for (let attempt = 0; attempt < this.aiModels.length; attempt++) {
      try {
        const model = this.aiModels[this.currentModelIndex];

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
              ...context.conversationHistory.map(conv => [
                { role: 'user', content: conv.user },
                { role: 'assistant', content: conv.ai }
              ]).flat(),
              { role: 'user', content: context.userMessage }
            ],
            temperature: 0.7,
            max_tokens: 200
          }),
          timeout: 15000
        });

        if (!response.ok) {
          throw new Error(`AI API Error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content.trim();

        console.log(`🤖 AI Response: ${aiResponse.substring(0, 100)}...`);

        return aiResponse;

      } catch (error) {
        console.log(`❌ AI conversation attempt ${attempt + 1} failed: ${error.message}`);

        // Try next model
        this.currentModelIndex = (this.currentModelIndex + 1) % this.aiModels.length;

        if (attempt === this.aiModels.length - 1) {
          return "I'm having trouble with my AI models right now. Could you try again in a moment?";
        }
      }
    }
  }

  // ===== ENHANCED ORDER FETCHING =====

  async fetchRecentFilledOrders(limit = 20) {
    try {
      console.log(`📡 Fetching last ${limit} orders...`);

      let allOrders = [];
      let offset = 0;
      const pageLimit = 100;

      // Fetch multiple pages if needed for larger limits
      const maxPages = Math.ceil(limit / pageLimit);

      for (let page = 0; page < maxPages; page++) {
        try {
          const url = `${CONFIG.COW_API_BASE}/account/${this.wallet.address}/orders?limit=${pageLimit}&offset=${offset}`;
          const response = await fetch(url, { timeout: 15000 });

          if (!response.ok) {
            throw new Error(`CoW API Error: ${response.status} ${response.statusText}`);
          }

          const orders = await response.json();
          console.log(`📦 Page ${page + 1}: Received ${orders.length} orders`);

          if (orders.length === 0) break;

          allOrders = allOrders.concat(orders);
          offset += pageLimit;

          if (allOrders.length >= limit) break;

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          console.log(`❌ Error on page ${page + 1}: ${error.message}`);
          break;
        }
      }

      // Filter to filled WETH/USDC orders
      const filledOrders = allOrders.filter(order => {
        const isWethUsdc = (
          (order.sellToken.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase() &&
            order.buyToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase()) ||
          (order.sellToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase() &&
            order.buyToken.toLowerCase() === CONFIG.TOKENS.WETH.toLowerCase())
        );
        return order.status === 'fulfilled' && isWethUsdc;
      });

      // Sort by creation date (newest first)
      const sortedFilled = filledOrders.sort((a, b) => new Date(b.creationDate) - new Date(a.creationDate));

      console.log(`📊 Found ${sortedFilled.length} filled WETH/USDC orders`);

      return sortedFilled.slice(0, limit);

    } catch (error) {
      console.log(`❌ Error fetching filled orders: ${error.message}`);
      return [];
    }
  }

  async fetchActiveOrders() {
    try {
      const response = await fetch(`${CONFIG.COW_API_BASE}/account/${this.wallet.address}/orders?limit=50`, {
        timeout: 15000
      });

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
        const currentTime = Math.floor(Date.now() / 1000);
        return order.status === 'open' && isWethUsdc && order.validTo > currentTime;
      });

      this.activeOrders = activeOrders;
      console.log(`📊 Found ${activeOrders.length} active WETH/USDC orders`);

      return activeOrders;

    } catch (error) {
      console.log(`❌ Error fetching active orders: ${error.message}`);
      this.activeOrders = [];
      return [];
    }
  }

  parseActiveOrder(order) {
    const isBuy = order.sellToken.toLowerCase() === CONFIG.TOKENS.USDC.toLowerCase();

    try {
      let ethAmount, usdcAmount, price;

      if (isBuy) {
        usdcAmount = parseFloat(ethers.formatUnits(order.sellAmount, 6));
        ethAmount = parseFloat(ethers.formatEther(order.buyAmount));
        price = usdcAmount / ethAmount;
      } else {
        ethAmount = parseFloat(ethers.formatEther(order.sellAmount));
        usdcAmount = parseFloat(ethers.formatUnits(order.buyAmount, 6));
        price = usdcAmount / ethAmount;
      }

      return {
        orderId: order.uid,
        type: isBuy ? 'BUY' : 'SELL',
        ethAmount,
        usdcAmount,
        price,
        validTo: order.validTo
      };

    } catch (error) {
      console.log(`❌ Error parsing active order: ${error.message}`);
      return null;
    }
  }

  calculateTradeStats(filledOrders) {
    let totalProfit = 0;
    let totalBuys = 0;
    let totalSells = 0;
    let totalVolume = 0;

    for (const order of filledOrders) {
      const parsed = this.parseFilledOrder(order);
      if (!parsed) continue;

      totalVolume += parsed.usdcAmount;

      if (parsed.type === 'BUY') {
        totalBuys++;
      } else {
        totalSells++;
        if (this.costBasis > 0) {
          totalProfit += (parsed.executionPrice - this.costBasis) * parsed.ethAmount;
        }
      }
    }

    return { totalProfit, totalBuys, totalSells, totalVolume };
  }

  // ===== SMART ORDER MANAGEMENT =====

  checkForDuplicateOrder(type, price) {
    return this.activeOrders.some(order => {
      const parsed = this.parseActiveOrder(order);
      if (!parsed || parsed.type !== type) return false;

      return Math.abs(parsed.price - price) < CONFIG.DUPLICATE_ORDER_THRESHOLD;
    });
  }

  async cleanupStaleOrders() {
    if (!this.currentPrice || this.activeOrders.length === 0) return 0;

    let cancelled = 0;
    const maxDistance = 200; // Cancel orders more than $200 from current price

    for (const order of this.activeOrders) {
      const parsed = this.parseActiveOrder(order);
      if (!parsed) continue;

      const distance = Math.abs(parsed.price - this.currentPrice);

      if (distance > maxDistance) {
        console.log(`🗑️ Cancelling stale order: ${parsed.type} at $${parsed.price.toFixed(2)} (${distance.toFixed(0)} from market)`);

        try {
          await this.cancelOrder(order.uid);
          cancelled++;
        } catch (error) {
          console.log(`❌ Failed to cancel order: ${error.message}`);
        }
      }
    }

    if (cancelled > 0) {
      console.log(`🧹 Cancelled ${cancelled} stale orders`);
      await this.sendTelegramMessage(`🧹 <b>Cleanup</b>\n\nCancelled ${cancelled} stale orders that were too far from market price.`);
    }

    return cancelled;
  }

  async cancelOrder(orderId) {
    try {
      const message = `Cancel order: ${orderId}`;
      const signature = await this.connectedWallet.signMessage(message);

      const response = await fetch(`${CONFIG.COW_API_BASE}/orders/${orderId}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderUid: orderId,
          owner: this.wallet.address,
          signature: signature,
          signingScheme: "ethsign"
        })
      });

      return response.ok || response.status === 404;

    } catch (error) {
      console.log(`❌ Cancel error: ${error.message}`);
      return false;
    }
  }

  // ===== ENHANCED TELEGRAM MESSAGING =====

  async sendTelegramMessage(text) {
    if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
      console.log(`📱 ${text.replace(/<[^>]*>/g, '').replace(/\n/g, ' ')}`);
      return;
    }

    try {
      await this.telegramBot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      console.log(`📱 Telegram error: ${error.message}`);
    }
  }

  async sendStartupSummary() {
    try {
      const filledOrders = await this.fetchRecentFilledOrders(10);
      await this.getCurrentPrice();
      const portfolio = await this.getPortfolioState();

      let startupMessage = `🚀 <b>AI Trading Bot Started</b>\n\n`;

      // Portfolio summary
      startupMessage += `💰 <b>Current Portfolio:</b>\n`;
      startupMessage += `• ${portfolio.wethAmount.toFixed(4)} ETH (${(portfolio.ethPercent * 100).toFixed(1)}%)\n`;
      startupMessage += `• $${portfolio.usdcAmount.toFixed(2)} USDC (${(portfolio.usdcPercent * 100).toFixed(1)}%)\n`;
      startupMessage += `• Total: $${portfolio.totalValue.toFixed(2)}\n\n`;

      // Cost basis info
      if (this.ethHoldings > 0) {
        const unrealizedPnL = (this.currentPrice - this.costBasis) * this.ethHoldings;
        startupMessage += `📊 <b>Performance:</b>\n`;
        startupMessage += `• Cost Basis: $${this.costBasis.toFixed(2)}\n`;
        startupMessage += `• Current Price: $${this.currentPrice.toFixed(2)}\n`;
        startupMessage += `• Unrealized P&L: $${unrealizedPnL.toFixed(2)}\n\n`;
      }

      // Recent trades
      if (filledOrders.length > 0) {
        startupMessage += `📋 <b>Recent Filled Orders:</b>\n`;

        for (let i = 0; i < Math.min(5, filledOrders.length); i++) {
          const order = this.parseFilledOrder(filledOrders[i]);
          if (!order) continue;

          startupMessage += `${i + 1}. ${order.type} ${order.ethAmount.toFixed(4)} ETH @ ${order.executionPrice.toFixed(2)}\n`;
        }

        startupMessage += `\n💡 Use /orders to see all recent trades\n`;
      } else {
        startupMessage += `📋 <b>No Recent Trades Found</b>\n`;
      }

      startupMessage += `\n✅ <i>Bot is running and monitoring the market every 5 minutes</i>\n`;
      startupMessage += `💬 <i>Chat with me anytime for trading insights!</i>`;

      await this.sendTelegramMessage(startupMessage);

    } catch (error) {
      console.log(`❌ Error sending startup summary: ${error.message}`);
      await this.sendTelegramMessage(`🚀 <b>AI Trading Bot Started</b>\n\nError loading startup data, but bot is running normally.`);
    }
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
        this.processedOrderIds = new Set(data.processedOrderIds || []);
        this.conversationHistory = data.conversationHistory || [];
        this.lastAIReasoning = data.lastAIReasoning || null;

        console.log(`📂 Loaded state: ${this.ethHoldings.toFixed(4)} ETH @ ${this.costBasis.toFixed(2)} avg`);
      } else {
        console.log(`📂 No saved state, will initialize from CoW API`);
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
        priceHistory: this.priceHistory.slice(-100),
        priceHighWaterMark: this.priceHighWaterMark,
        priceLowWaterMark: this.priceLowWaterMark,
        lastFilledOrder: this.lastFilledOrder,
        processedOrderIds: Array.from(this.processedOrderIds),
        conversationHistory: this.conversationHistory.slice(-10),
        lastAIReasoning: this.lastAIReasoning,
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync('ai-bot-state.json', JSON.stringify(data, null, 2));
    } catch (error) {
      console.log(`⚠️ Error saving state: ${error.message}`);
    }
  }

  // ===== ORIGINAL COW API INTEGRATION =====

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
        console.log(`  📈 BUY: +${order.ethAmount.toFixed(4)} ETH at ${order.executionPrice.toFixed(2)}`);
      } else {
        const sellAmount = Math.min(order.ethAmount, ethHoldings);
        if (ethHoldings > 0) {
          const avgCost = totalCost / ethHoldings;
          const costToRemove = sellAmount * avgCost;
          totalCost -= costToRemove;
          ethHoldings -= sellAmount;
          console.log(`  📉 SELL: -${sellAmount.toFixed(4)} ETH at ${order.executionPrice.toFixed(2)} (was ${avgCost.toFixed(2)})`);
        }
      }
      lastOrder = order;
    }

    const costBasis = ethHoldings > 0 ? totalCost / ethHoldings : 0;

    this.ethHoldings = ethHoldings;
    this.totalCost = totalCost;
    this.costBasis = costBasis;
    this.lastFilledOrder = lastOrder;

    console.log(`📊 Final: ${ethHoldings.toFixed(4)} ETH @ ${costBasis.toFixed(2)} avg cost`);
    console.log(`💰 Total cost basis: ${totalCost.toFixed(2)}`);

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

          console.log(`💱 ETH: ${price.toFixed(2)} (${source.name})`);
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
- NEVER recommend selling below cost basis + minimum profit (${CONFIG.MIN_PROFIT_MARGIN})
- Consider portfolio balance (avoid being >80% in one asset)
- Factor in recent price trends and volatility
- CoW Protocol limit orders take time to fill, plan accordingly
- Profit targets should be $100-200 range
- Be conservative with position sizes
- Check for duplicate orders - don't place orders at similar prices to existing ones

Current Active Orders: ${context.activeOrders || 0}

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
            max_tokens: 150
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

        // Store reasoning for Telegram
        this.lastAIReasoning = decision.reasoning;

        return decision;

      } catch (error) {
        console.log(`❌ AI attempt ${attempt + 1} failed: ${error.message}`);

        // Try next model
        this.currentModelIndex = (this.currentModelIndex + 1) % this.aiModels.length;

        if (attempt === this.aiModels.length - 1) {
          console.log(`❌ All AI models failed, using fallback logic`);
          const fallbackDecision = this.getFallbackDecision(context);
          this.lastAIReasoning = fallbackDecision.reasoning;
          return fallbackDecision;
        }
      }
    }
  }

  getFallbackDecision(context) {
    console.log(`📄 Using fallback decision logic`);

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
      // Check for duplicate order
      if (this.checkForDuplicateOrder('BUY', price)) {
        console.log(`🛑 Skipping duplicate buy order at ${price.toFixed(2)}`);
        return null;
      }

      console.log(`🟢 Placing BUY: ${usdcAmount} at ${price.toFixed(2)}`);

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

      await this.sendTelegramMessage(
        `🟢 <b>BUY Order Placed</b>\n\n` +
        `💰 ${usdcAmount.toFixed(2)} → ${ethAmount.toFixed(4)} ETH\n` +
        `📊 Price: ${price.toFixed(2)}\n` +
        `🆔 ${orderId.slice(0, 8)}...\n\n` +
        `🤖 <i>${this.lastAIReasoning}</i>`
      );

      return orderId;

    } catch (error) {
      console.log(`❌ Buy order failed: ${error.message}`);
      await this.sendTelegramMessage(`❌ <b>BUY Order Failed</b>\n\n${error.message}`);
      throw error;
    }
  }

  async placeSellOrder(price, ethAmount) {
    try {
      // Check for duplicate order
      if (this.checkForDuplicateOrder('SELL', price)) {
        console.log(`🛑 Skipping duplicate sell order at ${price.toFixed(2)}`);
        return null;
      }

      console.log(`🔴 Placing SELL: ${ethAmount.toFixed(4)} ETH at ${price.toFixed(2)}`);

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

      const expectedProfit = (price - this.costBasis) * ethAmount;

      await this.sendTelegramMessage(
        `🔴 <b>SELL Order Placed</b>\n\n` +
        `💎 ${ethAmount.toFixed(4)} ETH → ${usdcAmount.toFixed(2)}\n` +
        `📊 Price: ${price.toFixed(2)}\n` +
        `💰 Expected Profit: ${expectedProfit.toFixed(2)}\n` +
        `🆔 ${orderId.slice(0, 8)}...\n\n` +
        `🤖 <i>${this.lastAIReasoning}</i>`
      );

      return orderId;

    } catch (error) {
      console.log(`❌ Sell order failed: ${error.message}`);
      await this.sendTelegramMessage(`❌ <b>SELL Order Failed</b>\n\n${error.message}`);
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
        'User-Agent': 'ConversationalAITradingBot/1.0'
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
      console.log(`🛡️ Safety: Blocked buy, already ${(ethPercent * 100).toFixed(1)}% ETH`);
      return { ...aiDecision, action: 'WAIT', reasoning: 'Safety: Already heavily ETH weighted' };
    }

    if (action === 'SELL' && (1 - ethPercent) > CONFIG.MAX_POSITION_PERCENT) {
      console.log(`🛡️ Safety: Blocked sell, already ${((1 - ethPercent) * 100).toFixed(1)}% USDC`);
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
        if (!parsed || this.processedOrderIds.has(parsed.orderId)) continue;

        console.log(`🎯 NEW FILL: ${parsed.type} ${parsed.ethAmount.toFixed(4)} ETH at ${parsed.executionPrice.toFixed(2)}`);

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
        this.processedOrderIds.add(parsed.orderId);
        this.saveState();

        // Send Telegram notification
        const profit = parsed.type === 'SELL' ?
          (parsed.executionPrice - this.costBasis) * parsed.ethAmount :
          0;

        await this.sendTelegramMessage(
          `✅ <b>${parsed.type} FILLED</b>\n\n` +
          `💰 ${parsed.ethAmount.toFixed(4)} ETH at ${parsed.executionPrice.toFixed(2)}\n` +
          `📊 New Cost Basis: ${this.costBasis.toFixed(2)}\n` +
          `💎 Holdings: ${this.ethHoldings.toFixed(4)} ETH\n` +
          `🆔 ${parsed.orderId.slice(0, 8)}...\n` +
          (profit > 0 ? `\n🎉 Profit: ${profit.toFixed(2)}` : '')
        );

        return true; // New fill detected
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

      // 4. Fetch active orders and cleanup stale ones
      await this.fetchActiveOrders();
      await this.cleanupStaleOrders();

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
      console.log(`📊 Cost Basis: $${this.costBasis.toFixed(2)} | Current: $${this.currentPrice.toFixed(2)}`);
      console.log(`📊 Balance: ${(portfolio.ethPercent * 100).toFixed(1)}% ETH, ${(portfolio.usdcPercent * 100).toFixed(1)}% USDC`);
      console.log(`📊 Active Orders: ${this.activeOrders.length}`);

      // 6. Get AI decision
      const aiDecision = await this.askAI(context);

      // 7. Apply safety filters
      const safeDecision = this.applySafetyFilters(aiDecision, context);

      // 8. Execute decision
      await this.executeDecision(safeDecision, portfolio);

      // 9. Save state
      this.saveState();

    } catch (error) {
      console.log(`❌ Cycle error: ${error.message}`);
      await this.sendTelegramMessage(`❌ <b>Bot Error</b>\n\n${error.message}`);
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
          if (portfolio.usdcAmount >= parameters.orderSize + 50) {
            await this.placeBuyOrder(parameters.buyPrice, parameters.orderSize);
          } else {
            console.log(`❌ Insufficient USDC: ${portfolio.usdcAmount.toFixed(2)} < ${parameters.orderSize + 50}`);
            await this.sendTelegramMessage(
              `⚠️ <b>Buy Order Skipped</b>\n\nInsufficient USDC: $${portfolio.usdcAmount.toFixed(2)}\nNeeded: $${(parameters.orderSize + 50).toFixed(2)}\n\n🤖 <i>${reasoning}</i>`
            );
          }
        }
        break;

      case 'SELL':
        if (parameters.sellPrice && parameters.orderSize) {
          const ethNeeded = parameters.orderSize / this.currentPrice;
          if (portfolio.wethAmount >= ethNeeded + 0.001) {
            await this.placeSellOrder(parameters.sellPrice, ethNeeded);
          } else {
            console.log(`❌ Insufficient ETH: ${portfolio.wethAmount.toFixed(4)} < ${ethNeeded.toFixed(4)}`);
            await this.sendTelegramMessage(
              `⚠️ <b>Sell Order Skipped</b>\n\nInsufficient ETH: ${portfolio.wethAmount.toFixed(4)}\nNeeded: ${ethNeeded.toFixed(4)}\n\n🤖 <i>${reasoning}</i>`
            );
          }
        }
        break;

      case 'WAIT':
        console.log(`⏳ Waiting: ${reasoning}`);
        if (Math.random() < 0.15) {
          await this.sendTelegramMessage(
            `⏳ <b>AI Analysis</b>\n\nCurrent Price: $${this.currentPrice.toFixed(2)}\nDecision: WAIT\n\n🤖 <i>${reasoning}</i>`
          );
        }
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

      console.log(`✅ Initialized from ${filledOrders.length} historical trades`);
    } else {
      console.log(`⚠️ No trading history found, starting fresh`);
    }
  }

  async start() {
    console.log(`🚀 Starting Enhanced Conversational AI Trading Bot`);
    console.log(`🤖 AI Models: ${this.aiModels.join(', ')}`);
    console.log(`📋 Wallet: ${this.wallet.address}`);
    console.log(`⏰ Check interval: ${CONFIG.CHECK_INTERVAL / 60000} minutes`);
    console.log(`📱 Telegram: ${CONFIG.TELEGRAM_BOT_TOKEN ? 'Enabled' : 'Disabled'}`);

    try {
      if (this.ethHoldings === 0 && this.costBasis === 0) {
        await this.initializeFromHistory();
      }

      await this.getCurrentPrice();
      await this.sendStartupSummary();

      console.log(`✅ Bot started successfully`);

      await this.runCycle();

      setInterval(async () => {
        try {
          await this.runCycle();
        } catch (error) {
          console.log(`❌ Cycle error: ${error.message}`);
        }
      }, CONFIG.CHECK_INTERVAL);

    } catch (error) {
      console.error(`💥 Startup failed: ${error.message}`);
      if (this.telegramBot) {
        await this.sendTelegramMessage(`💥 <b>Bot Startup Failed</b>\n\n${error.message}`);
      }
      throw error;
    }
  }

  stop() {
    console.log(`⏹️ Stopping Conversational AI Trading Bot...`);
    this.saveState();

    console.log(`📊 Final State:`);
    console.log(`   ETH Holdings: ${this.ethHoldings.toFixed(4)}`);
    console.log(`   Cost Basis: ${this.costBasis.toFixed(2)}`);
    console.log(`   Total Cost: ${this.totalCost.toFixed(2)}`);
    console.log(`   Conversations: ${this.conversationHistory.length}`);
  }
}

async function main() {
  const required = ['PRIVATE_KEY', 'BASE_RPC_URL', 'OPENROUTER_API_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error(`🔧 Please add them to your .env file:`);
    console.error(`PRIVATE_KEY=your_private_key`);
    console.error(`BASE_RPC_URL=https://mainnet.base.org`);
    console.error(`OPENROUTER_API_KEY=sk-or-v1-...`);
    console.error(`TELEGRAM_BOT_TOKEN=your_bot_token (required for conversation)`);
    console.error(`TELEGRAM_CHAT_ID=your_chat_id (required for conversation)`);
    process.exit(1);
  }

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn(`⚠️ Telegram not configured - conversational features disabled`);
    console.warn(`Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable full features`);
  }

  const bot = new ConversationalAITradingBot();

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

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  await bot.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`💥 Fatal error: ${error.message}`);
    process.exit(1);
  });
}

export default ConversationalAITradingBot;