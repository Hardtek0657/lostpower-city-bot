import { SEL as shared } from '../selectors.js';

export const SEL = {
  videoPoker: {
    open: '[data-testid="button-openCasinoGame-video-poker"]',
    modal: '[data-testid="modal-casinoVideoPoker"]',
    variant: (v) => `[data-testid="button-videoPokerVariant-${v}"]`,
    wager: (n) => `[data-testid="button-videoPokerWager-${n}"]`,
    deal: '[data-testid="button-dealVideoPoker"]',
    draw: '[data-testid="button-drawVideoPoker"]',
    hold: (i) => `[data-testid="button-videoPokerHold-${i}"]`,
    result: '[data-testid="result-videoPoker"]',
    credits: shared.modalCredits,
  },
  vpWagers: [5, 10, 25, 50, 100, 250, 1000, 5000],
};
