<div align="center">
  <img src="assets/logo-banner.png" alt="AI-Enhanced CoW Trading Bot" width="800"/>
  
  # AI-Enhanced CoW Trading Bot
  
  **An intelligent cryptocurrency trading bot that uses AI to make trading decisions on CoW Protocol (Base network)**
  
  [![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
  [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
  [![Base Network](https://img.shields.io/badge/Network-Base-blue.svg)](https://base.org/)
  
  *Automatically trades WETH/USDC pairs while protecting your capital with built-in safety mechanisms*
  
</div>

## 📸 Bot in Action

<div align="center">
  <img src="assets/bot-running-screenshot.png" alt="Bot Running Screenshot" width="700"/>
  <p><em>Live trading bot monitoring ETH markets and making AI-powered decisions</em></p>
</div>

## 🎯 Key Features

<table>
<tr>
<td width="50%">

### 🧠 **AI-Powered Trading**
- Multiple AI models with fallback
- Market analysis and trend detection  
- Intelligent buy/sell timing
- Reasoning-based decisions

</td>
<td width="50%">

### 💾 **Smart Memory**
- Fetches complete trading history
- FIFO cost basis calculation
- **Never sells at a loss**
- Persistent state management

</td>
</tr>
<tr>
<td width="50%">

### 🛡️ **Safety First**
- Hard-coded protection rules
- Position size limits (80% max)
- Balance verification
- Multiple safety layers

</td>
<td width="50%">

### 📱 **Real-time Monitoring**
- Telegram notifications
- Order fill alerts
- Portfolio updates
- Error notifications

</td>
</tr>
</table>

## 🚀 Quick Start

### 📦 Installation
```bash
# Clone the repository
git clone https://github.com/Saga-Labs/ai-trading-bot.git
cd ai-trading-bot

# Install dependencies
npm install
```

### ⚙️ Environment Setup
Create a `.env` file:
```env
# 🔑 Required Keys
PRIVATE_KEY=your_wallet_private_key_here
BASE_RPC_URL=https://mainnet.base.org
OPENROUTER_API_KEY=sk-or-v1-your_openrouter_key_here

# 📱 Optional (Telegram Notifications)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# 🤖 Optional (Custom AI Models)
AI_MODELS=mistralai/mistral-7b-instruct,meta-llama/llama-3.1-8b-instruct
```

### 🎬 Launch
```bash
npm start
```

## 🤖 AI Models

<div align="center">

### 🆓 Default Models (FREE)

| Model | Speed | Quality | Cost |
|-------|-------|---------|------|
| 🔥 Mistral 7B | Fast | Good | FREE |
| 🦙 Llama 3.1 8B | Medium | Better | FREE |
| 💬 DialoGPT | Fast | Basic | FREE |

### 💎 Premium Options

| Model | Speed | Quality | Cost |
|-------|-------|---------|------|
| 🎭 Claude 3 Haiku | Very Fast | Excellent | Low |
| 🧠 GPT-4o Mini | Fast | Excellent | Medium |
| 👑 Claude 3 Sonnet | Medium | Outstanding | High |

</div>

## 🏗️ Architecture

<div align="center">
  <img src="assets/architecture-diagram.png" alt="Trading Bot Architecture" width="800"/>
  <p><em>Complete system architecture showing AI decision flow and safety mechanisms</em></p>
</div>

## 📊 How It Works

### 🔄 Trading Cycle (Every 5 Minutes)
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Price Check   │───▶│  Fill Detection │───▶│ Portfolio State │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  AI Analysis    │◀───┤ Safety Filters  │◀───┤ Order Execution │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 📊 Decision Matrix

| Condition | AI Recommendation | Safety Check | Action |
|-----------|-------------------|--------------|--------|
| Price > Cost Basis + $50 | SELL | ✅ Pass | Place Sell Order |
| Price < Cost Basis | SELL | ❌ Block | WAIT for Recovery |
| Portfolio 80%+ ETH | SELL | ✅ Pass | Rebalance Sell |
| Good Dip Opportunity | BUY | ✅ Pass | Place Buy Order |

### 🚀 Startup Process
1. **History Analysis**: Fetches your last 50 CoW trades
2. **Cost Basis**: Calculates average purchase price using FIFO
3. **Balance Check**: Compares calculated vs actual wallet balance
4. **AI Initialization**: Tests AI models and sets up decision system

## 🛡️ Safety Mechanisms

<div align="center">

### 🔒 Never Sell at Loss Protection
```javascript
// 🚫 Hard-coded rule - AI cannot override
if (sellPrice < costBasis + MIN_PROFIT_MARGIN) {
  return "WAIT" // 🛑 Refuse to sell
}
```

</div>

| Safety Layer | Description | Override |
|--------------|-------------|----------|
| 🔴 Loss Prevention | Never sell below cost basis + $50 | ❌ No |
| ⚖️ Position Limits | Max 80% in one asset | ❌ No |
| 💰 Min Order Size | $100 minimum trades | ❌ No |
| 🔍 Balance Verification | Checks actual vs calculated | ❌ No |
| 🤖 AI Fallback | Mathematical rules if AI fails | ❌ No |

## 📱 Telegram Integration

<div align="center">
  <img src="assets/telegram-notifications.png" alt="Telegram Notifications" width="600"/>
  <p><em>Real-time trading notifications delivered to your Telegram</em></p>
</div>

| Event Type | Notification Example |
|------------|---------------------|
| ✅ Order Filled | `BUY FILLED: 0.125 ETH at $4650 (profit: $150)` |
| 🎯 Order Placed | `SELL Order Placed: 0.1 ETH → $490 at $4900` |
| 📊 Status Update | `Portfolio: 65% ETH, Cost Basis: $4753` |
| ⚠️ Safety Alert | `Blocked sell: Price below cost basis` |
| 🤖 AI Decision | `AI Recommendation: WAIT (confidence: 85%)` |

## 📈 Example Scenarios

<details>
<summary><b>🟢 Profitable Market Scenario</b></summary>

📊 **Situation:**
- Cost Basis: $4,500
- Current Price: $4,700  
- Portfolio: 70% ETH, 30% USDC

🤖 **AI Analysis:**
"Price above cost basis with good profit margin. Portfolio slightly ETH-heavy. Recommend partial sell."

🛡️ **Safety Check:** ✅ PASS
- ✓ Price > cost basis + $50
- ✓ Portfolio within limits

🎯 **Action:** Place SELL order at $4,750

</details>

<details>
<summary><b>🔴 Underwater Position Scenario</b></summary>

📊 **Situation:**
- Cost Basis: $4,800
- Current Price: $4,600
- Portfolio: 85% ETH, 15% USDC

🤖 **AI Analysis:**
"Portfolio heavily ETH-weighted. Recommend rebalancing with partial sell despite current price."

🛡️ **Safety Check:** ❌ BLOCKED
- ✗ Price below cost basis
- ✓ Position limits exceeded

🎯 **Action:** WAIT for price recovery above $4,850

</details>

<details>
<summary><b>🟡 Buy Opportunity Scenario</b></summary>

📊 **Situation:**
- Cost Basis: $4,600
- Current Price: $4,400 (dipped)
- Portfolio: 25% ETH, 75% USDC

🤖 **AI Analysis:**
"Good dip opportunity with USDC-heavy portfolio. Price shows support at $4,380. Recommend buy."

🛡️ **Safety Check:** ✅ PASS
- ✓ Portfolio allows more ETH
- ✓ Order size adequate

🎯 **Action:** Place BUY order at $4,350

</details>

## 🔧 Configuration

### Trading Parameters
```javascript
MIN_PROFIT_MARGIN: 50,      // $50 minimum profit per trade
MAX_POSITION_PERCENT: 0.8,  // Max 80% in one asset  
MIN_ORDER_SIZE: 100,        // $100 minimum order
ORDER_VALIDITY_HOURS: 24,   // 24 hour order expiry
CHECK_INTERVAL: 5 * 60 * 1000, // 5 minute cycles
```

### AI Settings
- Temperature: 0.3 (conservative decisions)
- Max tokens: 500 (concise responses)
- Timeout: 15 seconds per request
- Automatic model rotation on failure

## 🚨 Important Notes

### Requirements
- Base network wallet with WETH/USDC
- OpenRouter account with API credits
- Node.js 18+ with ES modules support

### Risks
- Uses limit orders (no guaranteed execution)
- AI models can make mistakes (safety filters help)
- CoW Protocol settlement delays
- Market volatility can cause losses

### Best Practices
- Start with small amounts to test
- Monitor Telegram notifications
- Keep some ETH for gas fees
- Regularly check bot logs for issues

## 📁 Generated Files

- `ai-bot-state.json` - Bot state and cost basis
- `ai-enhanced-cow-trading-bot.log` - Detailed execution logs  

## 🤝 Support

The bot includes comprehensive logging and error handling. Check the console output and Telegram notifications for troubleshooting information.

---

**⚠️ Disclaimer**: This bot is for educational purposes. Cryptocurrency trading involves risk. Never trade with funds you cannot afford to lose.
