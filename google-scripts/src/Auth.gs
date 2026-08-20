function isActiveValue(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getUsersForLogin() {
  return getAllRows('Users')
    .filter(function (u) {
      return isActiveValue(u.Active);
    })
    .map(function (u) {
      return { userId: u.UserID, name: u.Name };
    });
}

function validatePinAndLogin(userId, pin) {
  var user = findRowById('Users', 'UserID', userId);
  if (!user) {
    return { ok: false, error: 'User not found' };
  }
  if (!isActiveValue(user.Active)) {
    return { ok: false, error: 'User is not active' };
  }
  if (String(user.PIN) !== String(pin)) {
    return { ok: false, error: 'Incorrect PIN' };
  }
  return {
    ok: true,
    session: {
      userId: user.UserID,
      name: user.Name,
      role: normalizeRole(user.Role),
      stages: parseJsonSafe(user.Stages, [])
    }
  };
}

function requirePermission(userId, stage) {
  var user = findRowById('Users', 'UserID', userId);
  if (!user || !isActiveValue(user.Active)) {
    throw new Error('Not authorized: inactive or unknown user');
  }
  var stages = parseJsonSafe(user.Stages, []);
  var allowed = normalizeRole(user.Role) === 'admin' || stages.indexOf('all') !== -1 || stages.indexOf(stage) !== -1;
  if (!allowed) {
    throw new Error('Not authorized for stage: ' + stage);
  }
  return user;
}
