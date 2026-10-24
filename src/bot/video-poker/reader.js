export const EXTRACT_JS = `(() => {
  const modal = document.querySelector('[data-testid="modal-casinoVideoPoker"]');
  if (!modal) return { open: false, phase: 'closed' };

  const num = (t) => {
    const m = String(t ?? '').replace(/,/g, '').match(/-?\\d+/);
    return m ? Number(m[0]) : null;
  };
  const face = (b) => {
    const f = b.querySelector('.videoPokerFace');
    const raw = (f ? f.innerText : b.innerText) || '';
    const toks = raw.replace(/tap to hold/gi, ' ').trim().split(/\\s+/).filter(Boolean);
    return { rank: toks[0] ?? null, suit: toks[1] ?? null };
  };

  const cards = [...modal.querySelectorAll('[data-testid^="button-videoPokerHold-"]')].map((b) => ({
    ...face(b),
    held: b.getAttribute('aria-pressed') === 'true',
    disabled: b.disabled,
  }));

  const vbtn = [...modal.querySelectorAll('[data-testid^="button-videoPokerVariant-"]')]
    .find((b) => b.getAttribute('aria-pressed') === 'true' || /(^|\\s)(active|selected)(\\s|$)/i.test(b.className));
  const pays = modal.querySelector('[data-testid="table-videoPokerPays"]')?.innerText ?? '';
  const text = modal.innerText;
  // Variant buttons name all three games, so detect from the active paytable instead.
  const variant = /FOUR DEUCES/i.test(pays) ? 'deuces-wild'
    : /FOUR ACES/i.test(pays) ? 'bonus-poker'
      : /JACKS OR BETTER/i.test(pays) ? 'jacks-or-better'
        : vbtn ? vbtn.dataset.testid.replace('button-videoPokerVariant-', '')
          : /every 2 is wild/i.test(text) ? 'deuces-wild'
            : /premium payouts for four aces/i.test(text) ? 'bonus-poker'
              : 'jacks-or-better';

  const deal = modal.querySelector('[data-testid="button-dealVideoPoker"]');
  const draw = modal.querySelector('[data-testid="button-drawVideoPoker"]');
  const result = modal.querySelector('[data-testid="result-videoPoker"]');
  const phase = draw ? 'in_hand' : deal ? 'ready' : result ? 'result' : 'unknown';

  return {
    open: true,
    phase,
    variant,
    cards,
    credits: num(document.querySelector('[data-testid="badge-casinoModalCredits"]')?.innerText),
    bet: num(modal.querySelector('[data-testid="panel-videoPokerBet"]')?.innerText),
    dealReady: Boolean(deal) && !deal.disabled,
    result: result?.innerText ?? null,
  };
})()`;

export async function readVideoPoker(webContents) {
  return webContents.executeJavaScript(EXTRACT_JS);
}
