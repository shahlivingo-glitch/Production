function getUsersForLogin() {
  return getAllRows('Users')
    .filter(function (u) {
      return u.Active === true || u.Active === 'TRUE';
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
  if (user.Active !== true && user.Active !== 'TRUE') {
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
      role: user.Role,
      stages: parseJsonSafe(user.Stages, [])
    }
  };
}

function requirePermission(userId, stage) {
  var user = findRowById('Users', 'UserID', userId);
  if (!user || (user.Active !== true && user.Active !== 'TRUE')) {
    throw new Error('Not authorized: inactive or unknown user');
  }
  var stages = parseJsonSafe(user.Stages, []);
  var allowed = user.Role === 'admin' || stages.indexOf('all') !== -1 || stages.indexOf(stage) !== -1;
  if (!allowed) {
    throw new Error('Not authorized for stage: ' + stage);
  }
  return user;
}
