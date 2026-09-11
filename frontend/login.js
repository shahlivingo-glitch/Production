function afterSignedIn(result) {
  saveSession(result.token, result.user);
  window.location.href = 'dashboard.html';
}

function initLogin() {
  // Already signed in with a still-valid session? Skip straight past login.
  var stored = getStoredSession();
  if (stored && stored.token) {
    apiGet('whoAmI', {}).then(function (result) {
      if (result.ok) {
        window.location.href = 'dashboard.html';
      } else {
        clearSession();
        showRealForm();
      }
    }).catch(showRealForm);
    return;
  }
  showRealForm();
}

function showRealForm() {
  apiGet('bootstrapStatus', {}).then(function (result) {
    el('loading-state').style.display = 'none';
    if (!result.ok) {
      el('login-form').style.display = 'block';
      el('login-error').textContent = 'Could not reach the server: ' + result.error;
      el('login-error').style.display = 'block';
      return;
    }
    if (result.data.hasAdmin) {
      el('login-form').style.display = 'block';
    } else {
      el('setup-form').style.display = 'block';
    }
  }).catch(function (err) {
    el('loading-state').style.display = 'none';
    el('login-form').style.display = 'block';
    el('login-error').textContent = 'Could not reach the server: ' + (err && err.message ? err.message : err);
    el('login-error').style.display = 'block';
  });
}

function submitSetup() {
  var username = el('setup-username').value.trim();
  var password = el('setup-password').value;
  var password2 = el('setup-password2').value;
  el('setup-error').style.display = 'none';

  if (!username) {
    el('setup-error').textContent = 'Choose a username.';
    el('setup-error').style.display = 'block';
    return;
  }
  if (password.length < 6) {
    el('setup-error').textContent = 'Password must be at least 6 characters.';
    el('setup-error').style.display = 'block';
    return;
  }
  if (password !== password2) {
    el('setup-error').textContent = 'Passwords do not match.';
    el('setup-error').style.display = 'block';
    return;
  }

  var btn = el('setup-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  apiPost('createInitialAdmin', { username: username, password: password }).then(function (result) {
    btn.disabled = false;
    btn.textContent = 'Create Admin Account';
    if (!result.ok) {
      el('setup-error').textContent = result.error;
      el('setup-error').style.display = 'block';
      return;
    }
    afterSignedIn(result.data);
  }).catch(function (err) {
    btn.disabled = false;
    btn.textContent = 'Create Admin Account';
    el('setup-error').textContent = err && err.message ? err.message : String(err);
    el('setup-error').style.display = 'block';
  });
}

function submitLogin() {
  var username = el('login-username').value.trim();
  var password = el('login-password').value;
  el('login-error').style.display = 'none';

  if (!username || !password) {
    el('login-error').textContent = 'Enter your username and password.';
    el('login-error').style.display = 'block';
    return;
  }

  var btn = el('login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  apiPost('login', { username: username, password: password }).then(function (result) {
    btn.disabled = false;
    btn.textContent = 'Sign In';
    if (!result.ok) {
      el('login-error').textContent = result.error;
      el('login-error').style.display = 'block';
      return;
    }
    afterSignedIn(result.data);
  }).catch(function (err) {
    btn.disabled = false;
    btn.textContent = 'Sign In';
    el('login-error').textContent = err && err.message ? err.message : String(err);
    el('login-error').style.display = 'block';
  });
}

document.addEventListener('DOMContentLoaded', function () {
  el('setup-btn').addEventListener('click', submitSetup);
  el('login-btn').addEventListener('click', submitLogin);
  ['setup-password2', 'login-password'].forEach(function (id) {
    el(id).addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (id === 'setup-password2') submitSetup();
      else submitLogin();
    });
  });
  initLogin();
});
