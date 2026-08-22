var appSettingsForm = null;

function renderAppSettingsView() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Setup Times'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Machine start-up, warm-up, and maintenance time — the same for every model, added once per order to the first job of each stage.';
  root.appendChild(guide);

  apiGet('appSettings', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    appSettingsForm = {
      cuttingSetupTime: result.data.cuttingSetupTime,
      bendingSetupTime: result.data.bendingSetupTime,
      assemblySetupTime: result.data.assemblySetupTime,
      fittingSetupTime: result.data.fittingSetupTime
    };
    renderAppSettingsForm();
  }).catch(showFatalError);
}

function renderAppSettingsForm() {
  var root = el('dashboard-root');

  root.appendChild(buildNumberField('Cutting setup (minutes)', appSettingsForm.cuttingSetupTime, function (v) { appSettingsForm.cuttingSetupTime = v; }));
  root.appendChild(buildNumberField('Bending setup (minutes)', appSettingsForm.bendingSetupTime, function (v) { appSettingsForm.bendingSetupTime = v; }));
  root.appendChild(buildNumberField('Assembly setup (minutes)', appSettingsForm.assemblySetupTime, function (v) { appSettingsForm.assemblySetupTime = v; }));
  root.appendChild(buildNumberField('Fitting setup (minutes)', appSettingsForm.fittingSetupTime, function (v) { appSettingsForm.fittingSetupTime = v; }));

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-block';
  saveBtn.textContent = 'Save Setup Times';
  saveBtn.addEventListener('click', function () {
    apiPost('saveAppSettings', {
      userId: currentSession.userId,
      cuttingSetupTime: appSettingsForm.cuttingSetupTime,
      bendingSetupTime: appSettingsForm.bendingSetupTime,
      assemblySetupTime: appSettingsForm.assemblySetupTime,
      fittingSetupTime: appSettingsForm.fittingSetupTime
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      alert('Setup times saved.');
    }).catch(showFatalError);
  });
  root.appendChild(saveBtn);
}
