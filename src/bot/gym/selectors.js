import { SEL as shared } from '../selectors.js';

export const SEL = {
  login: shared.login,
  gym: {
    page: '[data-testid="section-gym-page"]',
    status: '[data-testid="section-gym-status-summary"]',
    card: '[data-testid="section-gym-training-card"]',
    focus: {
      strength: '[data-testid="button-gym-focus-strength"]',
      speed: '[data-testid="button-gym-focus-speed"]',
      guard: '[data-testid="button-gym-focus-guard"]',
    },
    energy: '[data-testid="input-gym-energy-percent"]',
    preview: '[data-testid="section-gym-training-preview"]',
    train: '[data-testid="button-gym-train"]',
    impact: '[data-testid="section-gym-workout-impact"]',
    potential: '[data-testid="section-gym-training-potential"]',
    playerEnergy: '[data-testid="meter-energy"]',
    turns: '[data-testid="label-header-turns"]',
  },
  routes: {
    gym: '#/city/gym',
    privateGym: '#/city/private-gym',
  },
};
