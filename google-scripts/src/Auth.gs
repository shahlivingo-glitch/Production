// Login, sessions, and per-menu view/edit permissions.
//
// Password storage: Apps Script has no bcrypt/scrypt, only
// Utilities.computeDigest - passwords are stored as SHA-256(password + a
// random per-user salt). Weaker than a proper slow hash, but reasonable for
// a small internal tool given the platform. Disclosed, not hidden.
//
// Sessions: a Sessions row per logged-in browser (token -> userId). There's
// no practical way to use real cookies across the origins involved here
// (Vercel frontend, script.google.com, the script.googleusercontent.com
// redirect) so the frontend stores the token in localStorage and sends it
// as a parameter on every request (see app.js) - same shape as every other
// param this API already takes.
//
// Permissions: every non-admin user has a Permissions JSON blob,
// { <menuKey>: 'none' | 'view' | 'edit' }, one entry per MENU_KEYS. Admins
// bypass all permission checks (requirePermission / checkAccess in Code.gs
// short-circuit for role === 'admin').

var MENU_KEYS = ['cuttingConfig', 'orders', 'cuttingStage', 'bendingStage', 'extraInventory', 'sheetStock'];
var SESSION_DAYS = 30;

function sha256Hex(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function hashPassword(password, salt) {
  return sha256Hex(String(password) + ':' + String(salt));
}

function defaultPermissions() {
  var perms = {};
  MENU_KEYS.forEach(function (k) { perms[k] = 'none'; });
  return perms;
}

function sanitizePermissions(input) {
  var perms = defaultPermissions();
  if (input && typeof input === 'object') {
    MENU_KEYS.forEach(function (k) {
      var v = input[k];
      if (v === 'view' || v === 'edit') perms[k] = v;
    });
  }
  return perms;
}

function userRowToObject(r) {
  var isAdmin = r.Role === 'admin';
  var perms;
  if (isAdmin) {
    // Admins bypass permission checks everywhere, but handing the frontend a
    // fully-'edit' map means it never needs a separate "or is admin" branch
    // wherever it checks canView/canEdit.
    perms = {};
    MENU_KEYS.forEach(function (k) { perms[k] = 'edit'; });
  } else {
    perms = parseJsonSafe(r.Permissions, defaultPermissions());
  }
  return {
    userId: String(r.UserId),
    username: String(r.Username),
    role: isAdmin ? 'admin' : 'user',
    permissions: perms,
    createdAt: r.CreatedAt,
    createdBy: r.CreatedBy || ''
  };
}

function hasAnyUser() {
  return getAllRows('AppUsers').length > 0;
}

function bootstrapStatus() {
  return { hasAdmin: hasAnyUser() };
}

function startSession(userId) {
  var token = Utilities.getUuid() + Utilities.getUuid();
  var expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  appendRow('AppSessions', {
    Token: token,
    UserId: userId,
    CreatedAt: nowIso(),
    ExpiresAt: expires
  });
  return { token: token, user: userRowToObject(findRowById('AppUsers', 'UserId', userId)) };
}

function findUserByUsername(username) {
  return findRow('AppUsers', function (r) { return String(r.Username).toLowerCase() === String(username).toLowerCase(); });
}

// Only works while no user exists yet - the one-time "create the first admin
// account" flow (login.html shows this instead of a login form until then).
function createInitialAdmin(payload) {
  if (hasAnyUser()) {
    throw new Error('Setup already completed - an admin account already exists.');
  }
  var username = (payload.username || '').trim();
  var password = payload.password || '';
  if (!username) throw new Error('Choose a username.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');

  var salt = Utilities.getUuid();
  var userId = generateId('U');
  appendRow('AppUsers', {
    UserId: userId,
    Username: username,
    PasswordHash: hashPassword(password, salt),
    PasswordSalt: salt,
    Role: 'admin',
    Permissions: JSON.stringify({}),
    CreatedAt: nowIso(),
    CreatedBy: ''
  });
  return startSession(userId);
}

function login(payload) {
  var username = (payload.username || '').trim();
  var password = payload.password || '';
  var row = findUserByUsername(username);
  if (!row || hashPassword(password, row.PasswordSalt) !== row.PasswordHash) {
    throw new Error('Incorrect username or password.');
  }
  return startSession(String(row.UserId));
}

function logout(payload) {
  deleteRowsWhere('AppSessions', function (r) { return String(r.Token) === String(payload.token); });
  return { loggedOut: true };
}

// The Users row for a valid, unexpired token, or null. Internal - used by
// Code.gs's checkAccess on every action, and by the functions below.
function getSessionUser(token) {
  if (!token) return null;
  var session = findRowById('AppSessions', 'Token', token);
  if (!session) return null;
  if (session.ExpiresAt && new Date(session.ExpiresAt).getTime() < Date.now()) {
    return null;
  }
  return findRowById('AppUsers', 'UserId', session.UserId);
}

function whoAmI(payload) {
  var userRow = getSessionUser(payload.token);
  if (!userRow) {
    throw new Error('Not signed in.');
  }
  return userRowToObject(userRow);
}

function requireAdmin(token) {
  var userRow = getSessionUser(token);
  if (!userRow) throw new Error('Not signed in.');
  if (userRow.Role !== 'admin') throw new Error('Admin access required.');
  return userRow;
}

function changeOwnPassword(payload) {
  var userRow = getSessionUser(payload.token);
  if (!userRow) throw new Error('Not signed in.');
  if (hashPassword(payload.currentPassword || '', userRow.PasswordSalt) !== userRow.PasswordHash) {
    throw new Error('Current password is incorrect.');
  }
  var newPassword = payload.newPassword || '';
  if (newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
  var salt = Utilities.getUuid();
  writeRowUpdates('AppUsers', userRow._rowIndex, {
    PasswordHash: hashPassword(newPassword, salt),
    PasswordSalt: salt
  });
  return { changed: true };
}

// --- User management (admin only - each function double-checks via
// requireAdmin regardless of the outer Code.gs gate, as defense in depth) ---

function listUsers(payload) {
  requireAdmin(payload.token);
  return getAllRows('AppUsers').map(userRowToObject);
}

function createUser(payload) {
  var admin = requireAdmin(payload.token);
  var username = (payload.username || '').trim();
  var password = payload.password || '';
  if (!username) throw new Error('Choose a username.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  if (findUserByUsername(username)) {
    throw new Error('Username "' + username + '" is already taken.');
  }
  var salt = Utilities.getUuid();
  var userId = generateId('U');
  appendRow('AppUsers', {
    UserId: userId,
    Username: username,
    PasswordHash: hashPassword(password, salt),
    PasswordSalt: salt,
    Role: 'user',
    Permissions: JSON.stringify(sanitizePermissions(payload.permissions)),
    CreatedAt: nowIso(),
    CreatedBy: admin.Username
  });
  return userRowToObject(findRowById('AppUsers', 'UserId', userId));
}

function updateUserPermissions(payload) {
  requireAdmin(payload.token);
  var row = findRowById('AppUsers', 'UserId', payload.userId);
  if (!row) throw new Error('User not found');
  if (row.Role === 'admin') throw new Error("Admins always have full access - there's nothing to set.");
  writeRowUpdates('AppUsers', row._rowIndex, {
    Permissions: JSON.stringify(sanitizePermissions(payload.permissions))
  });
  return userRowToObject(findRowById('AppUsers', 'UserId', payload.userId));
}

function resetUserPassword(payload) {
  requireAdmin(payload.token);
  var row = findRowById('AppUsers', 'UserId', payload.userId);
  if (!row) throw new Error('User not found');
  var password = payload.password || '';
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  var salt = Utilities.getUuid();
  writeRowUpdates('AppUsers', row._rowIndex, {
    PasswordHash: hashPassword(password, salt),
    PasswordSalt: salt
  });
  return { userId: payload.userId };
}

function deleteUser(payload) {
  var admin = requireAdmin(payload.token);
  var row = findRowById('AppUsers', 'UserId', payload.userId);
  if (!row) throw new Error('User not found');
  if (row.Role === 'admin') throw new Error('Cannot delete an admin account.');
  if (String(row.UserId) === String(admin.UserId)) throw new Error('Cannot delete your own account.');
  deleteRowsWhere('AppUsers', function (r) { return String(r.UserId) === String(payload.userId); });
  deleteRowsWhere('AppSessions', function (r) { return String(r.UserId) === String(payload.userId); });
  return { userId: payload.userId };
}
