var allUsers = [];

// The 6 grantable menus, reusing NAV_PAGES (app.js) so labels never drift
// out of sync with the actual nav.
var PERMISSION_MENUS = NAV_PAGES.filter(function (p) { return p.menu; }).map(function (p) {
  return { key: p.menu, label: p.label };
});

function buildPermissionsGrid(container, initialPerms) {
  container.innerHTML = '';
  var selects = {};
  PERMISSION_MENUS.forEach(function (m) {
    var row = document.createElement('div');
    row.className = 'field-row';
    row.style.flexDirection = 'row';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';

    var label = document.createElement('label');
    label.textContent = m.label;
    label.style.margin = '0';

    var select = document.createElement('select');
    select.style.width = 'auto';
    ['none', 'view', 'edit'].forEach(function (level) {
      var opt = document.createElement('option');
      opt.value = level;
      opt.textContent = level === 'none' ? 'No Access' : (level === 'view' ? 'View Only' : 'View + Edit');
      select.appendChild(opt);
    });
    select.value = (initialPerms && initialPerms[m.key]) || 'none';
    selects[m.key] = select;

    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  });

  return function getValues() {
    var perms = {};
    PERMISSION_MENUS.forEach(function (m) { perms[m.key] = selects[m.key].value; });
    return perms;
  };
}

function initUsers() {
  var me = getCurrentUser();
  if (!me || me.role !== 'admin') {
    el('not-admin-notice').style.display = 'block';
    return;
  }
  el('page-body').style.display = 'flex';
  getNewUserPermsValues = buildPermissionsGrid(el('new-permissions-grid'), null);
  loadUsers();
}

var getNewUserPermsValues = null;

function loadUsers() {
  el('users-loading').style.display = 'flex';
  el('users-error').style.display = 'none';
  el('users-list').innerHTML = '';

  apiGet('listUsers', {}).then(function (result) {
    el('users-loading').style.display = 'none';
    if (!result.ok) {
      el('users-error').textContent = 'Could not load Users: ' + result.error;
      el('users-error').style.display = 'block';
      return;
    }
    allUsers = result.data;
    renderUsersList();
  }).catch(function (err) {
    el('users-loading').style.display = 'none';
    el('users-error').textContent = 'Could not load Users: ' + (err && err.message ? err.message : err);
    el('users-error').style.display = 'block';
  });
}

function renderUsersList() {
  var list = el('users-list');
  list.innerHTML = '';

  if (allUsers.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No users yet.';
    list.appendChild(empty);
    return;
  }

  var me = getCurrentUser();
  allUsers.forEach(function (u) {
    list.appendChild(buildUserCard(u, me));
  });
}

function buildUserCard(u, me) {
  var card = document.createElement('div');
  card.className = 'sheet-card';

  var header = document.createElement('div');
  header.className = 'sheet-header';
  var title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = u.username + (u.role === 'admin' ? ' (Admin)' : '') + (u.userId === me.userId ? ' — you' : '');
  header.appendChild(title);

  if (u.role !== 'admin' && u.userId !== me.userId) {
    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete user';
    deleteBtn.addEventListener('click', function () { deleteUserClick(u); });
    header.appendChild(deleteBtn);
  }
  card.appendChild(header);

  if (u.role === 'admin') {
    var hint = document.createElement('div');
    hint.className = 'section-hint';
    hint.textContent = 'Admins always have full view + edit access to everything.';
    card.appendChild(hint);
    return card;
  }

  var gridWrap = document.createElement('div');
  var getPermValues = buildPermissionsGrid(gridWrap, u.permissions);
  card.appendChild(gridWrap);

  var actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = 'var(--space-2)';
  actions.style.marginTop = 'var(--space-2)';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Save Permissions';
  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    apiPost('updateUserPermissions', { userId: u.userId, permissions: getPermValues() }).then(function (result) {
      saveBtn.disabled = false;
      if (!result.ok) { showFatalError(result.error); return; }
      loadUsers();
    }).catch(function (err) { saveBtn.disabled = false; showFatalError(err); });
  });
  actions.appendChild(saveBtn);

  var resetBtn = document.createElement('button');
  resetBtn.className = 'btn-secondary';
  resetBtn.textContent = 'Reset Password';
  resetBtn.addEventListener('click', function () { resetPasswordClick(u); });
  actions.appendChild(resetBtn);

  card.appendChild(actions);
  return card;
}

function resetPasswordClick(u) {
  var password = prompt('New password for "' + u.username + '" (min 6 characters):');
  if (password === null) return;
  if (password.length < 6) {
    alert('Password must be at least 6 characters.');
    return;
  }
  apiPost('resetUserPassword', { userId: u.userId, password: password }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    alert('Password updated for "' + u.username + '".');
  }).catch(showFatalError);
}

function deleteUserClick(u) {
  if (!confirm('Delete user "' + u.username + '"? This cannot be undone.')) return;
  apiPost('deleteUser', { userId: u.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    loadUsers();
  }).catch(showFatalError);
}

function createUser() {
  var username = el('new-username').value.trim();
  var password = el('new-password').value;
  el('new-user-error').style.display = 'none';

  if (!username) {
    el('new-user-error').textContent = 'Choose a username.';
    el('new-user-error').style.display = 'block';
    return;
  }
  if (password.length < 6) {
    el('new-user-error').textContent = 'Password must be at least 6 characters.';
    el('new-user-error').style.display = 'block';
    return;
  }

  var btn = el('create-user-btn');
  btn.disabled = true;
  apiPost('createUser', {
    username: username,
    password: password,
    permissions: getNewUserPermsValues()
  }).then(function (result) {
    btn.disabled = false;
    if (!result.ok) {
      el('new-user-error').textContent = result.error;
      el('new-user-error').style.display = 'block';
      return;
    }
    el('new-username').value = '';
    el('new-password').value = '';
    getNewUserPermsValues = buildPermissionsGrid(el('new-permissions-grid'), null);
    loadUsers();
  }).catch(function (err) {
    btn.disabled = false;
    el('new-user-error').textContent = err && err.message ? err.message : String(err);
    el('new-user-error').style.display = 'block';
  });
}

document.addEventListener('DOMContentLoaded', function () {
  el('create-user-btn').addEventListener('click', createUser);
  requireAuth().then(function () {
    renderSideNav('users');
    initUsers();
  });
});
