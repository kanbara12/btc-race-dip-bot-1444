[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/kanbara12/btc-race-dip-bot-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/kanbara12/btc-race-dip-bot-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# Dip-buy bot v4 — btc-race-24h-20261118-1444 (kanbara12)

Long-only dip-buy bot for cbBTC/USDC (Orca Whirlpool, 1-minute bars, $1,000 paper).

Built for the [make.fun bounty "Race a BTC trading bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261118-1444) ($250 in USDC).

Strategy: scale-in on dips below the 4-hour rolling high — leg 1 buys half the
cash at -1.40% with a bounce, leg 2 spends the rest at -1.80% below the
average entry. Exits: take-profit +2.00%, trailing stop armed at +0.90%
(sell on a 0.18% pullback from the peak), stop-loss -2.50%.

Dev grade (kit `grade-local`, this competition's 1,440-bar dev window):
net PnL +$8.64, 5 trades, max drawdown 1.50%, guardrails met.

Run: `main.ts` (Node 22, stdlib only via `vendor/makefun-bars.ts`,
protocol agent-fun/bars-replay/v1). Deterministic: no clock, no
randomness, no network, no files.

Referral: https://make.fun/?ref=wfzk99wk
