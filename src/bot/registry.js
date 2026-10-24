import { startBlackjack } from './blackjack/loop.js';
import { startVideoPoker } from './video-poker/loop.js';
import { readVideoPoker } from './video-poker/reader.js';
import { VARIANTS } from './video-poker/cards.js';

export const features = [
  {
    id: 'blackjack',
    label: 'Blackjack autopilot',
    description: 'Playland Casino → Back Room Blackjack. Reads the hand and plays the strategy table.',
    start: startBlackjack,
    settings: [
      {
        key: 'bet', label: 'Bet per hand', type: 'select',
        options: [10, 20, 50, 100, 200, 500, 1000, 5000], default: 10,
      },
      { key: 'maxHands', label: 'Max hands', type: 'number', default: 50, min: 1, max: 5000 },
      { key: 'stopLoss', label: 'Stop after loss', type: 'number', default: 100, min: 1, max: 100000 },
      {
        key: 'decisionMode', label: 'Decisions', type: 'select',
        options: ['table', 'audit', 'llm'], default: 'table',
      },
      { key: 'dryRun', label: 'Dry run (no deal)', type: 'bool', default: true },
      { key: 'maxSessionMinutes', label: 'Session cap (min)', type: 'number', default: 60, min: 1, max: 720 },
      { key: 'allowTableFallback', label: 'Fallback to basic strategy', type: 'bool', default: true },
    ],
  },
  {
    id: 'video-poker',
    label: 'Video poker',
    description: 'Playland Casino → Video Poker. Exact EV over all 32 hold patterns.',
    start: startVideoPoker,
    read: readVideoPoker,
    settings: [
      { key: 'variant', label: 'Game', type: 'select', options: VARIANTS, default: 'jacks-or-better' },
      {
        key: 'bet', label: 'Bet per hand', type: 'select',
        options: [5, 10, 25, 50, 100, 250, 1000, 5000], default: 5,
      },
      { key: 'maxHands', label: 'Max hands', type: 'number', default: 50, min: 1, max: 5000 },
      { key: 'stopLoss', label: 'Stop after loss', type: 'number', default: 100, min: 1, max: 100000 },
      { key: 'dryRun', label: 'Dry run (no deal)', type: 'bool', default: true },
      { key: 'maxSessionMinutes', label: 'Session cap (min)', type: 'number', default: 60, min: 1, max: 720 },
    ],
  },
];

/** Serializable view for the panel. */
export function featureView(cfg) {
  return features.map(({ start, read, ...f }) => ({
    ...f,
    enabled: Boolean(cfg.features?.[f.id]?.enabled),
  }));
}
