# Premium Poker Game v0.3.0

Готовый runnable web-проект для Texas Hold'em No-Limit.

## Запуск

```bash
npm install
npm test
npm start
```

Открыть `http://localhost:3000`.

## Что уже внутри

- Texas Hold'em No-Limit, 2–10 seats.
- Server-authoritative action validation.
- Secure server shuffle через `crypto.randomInt`.
- 52 уникальные карты.
- Best 5 of 7 evaluator, включая wheel и royal/straight flush.
- Heads-up blind/action handling.
- Fold / Check / Call / Bet / Raise / All-In.
- Short all-in не требует полной minimum raise.
- Automatic runout, showdown и payout.
- Main/side pot construction by contribution levels.
- Split/odd-chip deterministic payout order.
- Action IDs для idempotency.
- Event log в состоянии hand.
- Reconnect/resync command.
- Disconnect переводит игрока в sit-out state.
- Простая AI с ограниченной информацией: bot получает только свои hole cards и публичное состояние.
- Premium responsive UI для desktop/mobile.

## Важно

Это v0.3 игрового продукта: ядро и runnable client/server уже собраны, но production deployment всё ещё требует persistent DB/transactions, полноценный reconnect grace-period, authoritative timeout worker, load/security suite, tournament/cash modules, observability и CI/CD.
