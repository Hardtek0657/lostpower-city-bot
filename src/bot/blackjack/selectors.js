import { SEL as shared } from '../selectors.js';

export const SEL = {
  login: shared.login,
  casino: {
    ...shared.casino,
    blackjackCard: '[data-testid="card-casinoGame-blackjack"]',
    playNow: '[data-testid="button-openCasinoGame-blackjack"]',
  },
  table: {
    modal: '[data-testid="modal-casinoBlackjack"]',
    credits: shared.modalCredits,
    close: '[data-testid="button-closeCasinoModal"]',
    idle: '[data-testid="blackjackTableIdle"]',
    table: '[data-testid="blackjackTable"]',
    hands: '[data-testid="blackjackHands"]',
    result: '[data-testid="result-blackjack"]',
    actions: '[data-testid="actions-blackjackActive"]',
    deal: '[data-testid="button-startBlackjack"]',
    sameBet: '[data-testid="button-blackjackSameBet"]',
    maxBet: '[data-testid="button-blackjackMaxBet"]',
    rules: '[data-testid="text-blackjackRulesSummary"]',
    wager: (n) => `[data-testid="button-blackjackWager-${n}"]`,
    action: {
      hit: '[data-testid="button-blackjackHit"]',
      stand: '[data-testid="button-blackjackStand"]',
      double: '[data-testid="button-blackjackDouble"]',
      split: '[data-testid="button-blackjackSplit"]',
      forfeit: '[data-testid="button-blackjackForfeit"]',
    },
  },
  card: {
    dealerPrefix: 'card-blackjackDealer-',
    playerPrefix: 'card-blackjackPlayer-',
    dealer: (i) => `[data-testid="card-blackjackDealer-${i}"]`,
    hole: '[data-testid="card-blackjackDealer-hole"]',
    player: (hand, i) => `[data-testid="card-blackjackPlayer-${hand}-${i}"]`,
  },
  handPrefix: 'blackjackHand-',
  wagers: [10, 20, 50, 100, 200, 500, 1000, 5000],
};
