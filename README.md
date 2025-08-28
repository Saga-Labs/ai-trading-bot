<div align="center">
  
  # 🤖 AI Trading Bot for CoW Protocol
  
  <div align="center">
    <img src="assets/baselogo.png" alt="Base" height="60"/>
    &nbsp;&nbsp;&nbsp;&nbsp;
    <img src="assets/cowlogo.png" alt="CoW Protocol" height="60"/>
    &nbsp;&nbsp;&nbsp;&nbsp;
    <img src="assets/ethereumlogo.png" alt="Ethereum" height="60"/>
  </div>
  
  <br/>
  
  **Automated WETH/USDC trading on Base network with AI decision making**
  
  Chat with your trading bot via Telegram while it makes smart buy/sell decisions every 5 minutes
  
</div>

## 📸 Bot in Action

<div align="center">
  <img src="assets/bot-running-screenshot.png" alt="Bot Running Screenshot" width="700"/>
  <p><em>Live trading bot monitoring ETH markets and making AI-powered decisions</em></p>
</div>

## 🚀 Quick Start

### Install
```bash
git clone https://github.com/your-repo/ai-trading-bot.git
cd ai-trading-bot
npm install
```

### Setup Environment
Create `.env` file:
```env
PRIVATE_KEY=your_wallet_private_key
BASE_RPC_URL=https://mainnet.base.org
OPENROUTER_API_KEY=sk-or-v1-your_key

# Optional Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Run
```bash
npm start
```

## ✨ Key Features

- 🧠 **AI-powered decisions** with multiple model fallbacks
- 💾 **Smart memory** - tracks all your trading history
- 🛡️ **Loss protection** - designed to prevent selling at a loss
- 📱 **Telegram chat** - talk to your AI trading assistant
- 🔄 **Active order management** - cancels stale orders automatically

## 📋 Requirements

- **$1000+ portfolio** in WETH and USDC to start trading
- **Base network wallet** with funds
- **OpenRouter API key** (free models available)
- **Telegram bot** (optional but recommended)

## 🔄 How It Works

1. **Fetches Price**: Gets current ETH price from multiple sources
2. **Analyzes History**: Reviews your past trades to calculate cost basis
3. **AI Decision**: Determines if market conditions are good to trade
4. **Safety Check**: Blocks trades that would result in losses
5. **Execute**: Places buy/sell orders on CoW Protocol

## 📱 Telegram Integration

<div align="center">
  <img src="assets/telegram-notifications.png" alt="Telegram Notifications" width="600"/>
  <p><em>Real-time trading notifications delivered to your Telegram</em></p>
</div>

### Commands & AI Chat
- `/status` - Portfolio and bot status
- `/orders` - Recent filled trades
- `/active` - Current open orders
- **Chat with AI** - Ask questions about trades and market conditions

<div align="center">
  <img src="assets/telegram-notification2.png" alt="AI Telegram Replies" width="600"/>
  <p><em>AI-powered responses and analysis directly in your Telegram chat</em></p>
</div>

## 📊 Example Output

```
💱 ETH: $4,650.23 (CoinGecko)
📊 Portfolio: 0.2150 ETH + $1,247 USDC
🤖 AI Decision: SELL (confidence: 85%)
🔴 SELL Order Placed: 0.1 ETH → $490 at $4900
```

## 🛡️ Safety Features

- **Profit margins**: Always keeps minimum $50 profit buffer
- **Portfolio balance**: Never goes more than 80% in one asset
- **AI fallbacks**: Multiple models prevent single points of failure
- **Balance verification**: Checks funds before placing orders
- **Order cleanup**: Automatically cancels stale orders

## ⚠️ Important Disclaimers

- **Experimental software** - Start with small amounts
- **No guarantees** - Markets are unpredictable
- **Your responsibility** - Review all trades and settings
- **Gas fees** - Factor in transaction costs
- **Market risks** - Crypto trading involves significant risk

---

**Ready to start?** Make sure you have funds in your wallet and run `npm start`.