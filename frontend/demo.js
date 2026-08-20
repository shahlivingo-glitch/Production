var demoTimerHandle = null;

function demoSeenKey(userId) {
  return 'almirah_demo_seen_' + userId;
}

function hasSeenDemo(userId) {
  return localStorage.getItem(demoSeenKey(userId)) === '1';
}

function markDemoSeen(userId) {
  localStorage.setItem(demoSeenKey(userId), '1');
}

function stopDemoTimer() {
  if (demoTimerHandle) {
    clearInterval(demoTimerHandle);
    demoTimerHandle = null;
  }
}

function finishDemo(session) {
  stopDemoTimer();
  markDemoSeen(session.userId);
  renderDashboard(session);
}

function renderDemoIntro(session) {
  currentSession = session;
  el('login-root').style.display = 'none';
  el('topbar').style.display = 'flex';
  el('topbar-username').textContent = session.name + ' (' + session.role + ')';

  var root = el('dashboard-root');
  root.style.display = 'block';
  root.innerHTML = '';

  var card = document.createElement('div');
  card.className = 'card center-col';
  card.innerHTML =
    '<h2 style="margin-top:0;">Welcome, ' + session.name + '!</h2>' +
    '<p class="muted">Before you touch real orders, try a 60-second demo of how every stage works — tap the card, do the work, mark it done.</p>';
  root.appendChild(card);

  var tryBtn = document.createElement('button');
  tryBtn.className = 'btn btn-primary btn-block';
  tryBtn.style.marginTop = '16px';
  tryBtn.textContent = 'Try a Quick Demo';
  tryBtn.addEventListener('click', function () { renderDemoQueue(session); });
  root.appendChild(tryBtn);

  var skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn-secondary btn-block';
  skipBtn.style.marginTop = '10px';
  skipBtn.textContent = 'Skip to Dashboard';
  skipBtn.addEventListener('click', function () { finishDemo(session); });
  root.appendChild(skipBtn);
}

function renderDemoQueue(session) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Demo — Cutting'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'This is fake data — nothing here touches your real Sheet. Every locked-queue stage (Cutting, Bending) works exactly like this.';
  root.appendChild(guide);

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="list-row-title">Sheet A — Demo Model</div>' +
    '<div class="muted">Order DEMO-001 · Demo Customer</div>' +
    '<div class="muted">Target: 5 min · Parts: Demo Part 1, Demo Part 2</div>';
  root.appendChild(card);

  var startBtn = document.createElement('button');
  startBtn.className = 'btn btn-primary btn-block';
  startBtn.style.marginTop = '16px';
  startBtn.textContent = 'Start Cutting';
  startBtn.addEventListener('click', function () { renderDemoInProgress(session); });
  root.appendChild(startBtn);
}

function renderDemoInProgress(session) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Demo — Cutting'));

  var timerCard = document.createElement('div');
  timerCard.className = 'card center-col';
  timerCard.innerHTML = '<div class="muted">Elapsed</div><div id="demo-timer" style="font-size:36px;font-weight:800;">00:00</div>';
  root.appendChild(timerCard);

  var startedAt = Date.now();
  stopDemoTimer();
  demoTimerHandle = setInterval(function () {
    var timerEl = el('demo-timer');
    if (!timerEl) {
      stopDemoTimer();
      return;
    }
    var elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    var m = Math.floor(elapsedSec / 60);
    var s = elapsedSec % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);

  var doneBtn = document.createElement('button');
  doneBtn.className = 'btn btn-primary btn-block';
  doneBtn.style.marginTop = '16px';
  doneBtn.textContent = 'Mark Done';
  doneBtn.addEventListener('click', function () {
    stopDemoTimer();
    renderDemoQC(session);
  });
  root.appendChild(doneBtn);
}

function renderDemoQC(session) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Demo — Recount'));

  var summary = document.createElement('div');
  summary.className = 'guide-banner';
  summary.textContent = 'Nice work! Now recount before it moves on — this happens right after every Cutting and Bending job.';
  root.appendChild(summary);

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="muted">Parts on this sheet</div><div class="list-row-title">Demo Part 1, Demo Part 2</div>';
  root.appendChild(card);

  var passBtn = document.createElement('button');
  passBtn.className = 'btn btn-primary btn-block';
  passBtn.style.marginTop = '16px';
  passBtn.textContent = 'Pass';
  passBtn.addEventListener('click', function () { renderDemoOutro(session); });
  root.appendChild(passBtn);
}

function renderDemoOutro(session) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Demo Complete'));

  var card = document.createElement('div');
  card.className = 'card center-col';
  card.innerHTML =
    '<h2 style="margin-top:0;">That\'s the pattern!</h2>' +
    '<p class="muted">Tap the card, start the work, mark it done, recount if needed. Every real stage in this app follows the same flow. You\'re ready for real orders.</p>';
  root.appendChild(card);

  var finishBtn = document.createElement('button');
  finishBtn.className = 'btn btn-primary btn-block';
  finishBtn.style.marginTop = '16px';
  finishBtn.textContent = 'Go to Dashboard';
  finishBtn.addEventListener('click', function () { finishDemo(session); });
  root.appendChild(finishBtn);
}
