// End-to-end browser smoke driver (loaded by tests/smoke.html, served by server.js).
const out = document.createElement('div');
out.id = 'smoke-result';
document.body.append(out);
const fail = (m) => { out.textContent = 'SMOKE FAIL: ' + m; };

async function driver() {
  try {
    for (let i = 0; i < 100 && !window.__fivedice; i++) await new Promise((r) => setTimeout(r, 50));
    if (!window.__fivedice) return fail('no harness');
    const { session, startContent, platform } = window.__fivedice;
    platform.settings.reducedMotion = true;
    const { practiceDef } = await import('/js/content.js');
    const rules = await import('/js/rules.js');
    startContent(practiceDef({ difficulty: 'ember' }));
    let guard = 0;
    while (session.state.status === 'active' && guard++ < 4000) {
      await new Promise((r) => setTimeout(r, 20));
      if (!session.isHumanTurn()) continue;
      const legal = rules.listLegalActions(session.state);
      if (legal.canRoll) session.roll();
      else if (legal.scoreable.length) session.scoreCategory(legal.scoreable[0]);
    }
    if (session.state.status !== 'finished') return fail('did not finish, status=' + session.state.status);
    const okReplay = session.verifyOwnReplay();
    const breakdown = session.outcome().breakdown;
    out.textContent = 'SMOKE OK status=' + session.state.status +
      ' grand=' + breakdown.grand + ' replay=' + okReplay +
      ' cmds=' + session.commands.length + ' machine=' + session.machine;
  } catch (e) {
    fail(e.message + ' @ ' + (e.stack || '').split('\n')[1]);
  }
}
driver();
