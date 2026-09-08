var API_URL = 'https://script.google.com/macros/s/AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw/exec';

function el(id) { return document.getElementById(id); }

function apiGet(action, params) {
  var url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) {
    url.searchParams.set(k, params[k]);
  });
  return fetch(url.toString()).then(function (r) { return r.json(); });
}

function apiPost(action, payload) {
  var body = Object.assign({ action: action }, payload || {});
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

function showFatalError(err) {
  alert('Something went wrong: ' + (err && err.message ? err.message : err));
}

document.addEventListener('DOMContentLoaded', function () {
  if (typeof initCuttingConfig === 'function') {
    initCuttingConfig();
  }
});
