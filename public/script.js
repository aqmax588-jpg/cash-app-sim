/* ================= 基础 ================= */
const API = '/api';
const uid = localStorage.getItem('uid');
const clientId = localStorage.getItem('clientId');

if (!uid || !clientId) {
  location.replace('/');
}

let userInfo = {
  uid: uid,
  nickname: uid,
  avatar: '',
  balance: 0
};
try {
  const cached = JSON.parse(localStorage.getItem('userInfo') || '{}');
  if (cached && cached.uid) userInfo = Object.assign(userInfo, cached);
} catch (e) {}

let records = [];
let searchHistoryList = [];

const state = {
  amount: '',
  receiver: null,
  note: '',
  page: 'home',
  searchInput: '',
  payRecord: null,
  toastTimer: null
};

const app = document.getElementById('app');

/* ================= 工具 ================= */
function money(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function avatarHtml(user, cls) {
  const c = cls || 'avatar-circle';
  if (user && user.avatar) {
    const letter = ((user.nickname || user.uid) || '?').slice(0, 1).toUpperCase();
    return '<div class="' + c + '"><img src="' + user.avatar + '" alt="avatar" onerror="this.parentNode.innerHTML=\'' + letter + '\'"></div>';
  }
  const letter2 = ((user && (user.nickname || user.uid)) || '?').slice(0, 1).toUpperCase();
  return '<div class="' + c + '">' + letter2 + '</div>';
}

/* ================= 顶部通知（独立计时 2 秒） ================= */
function showToast(name, amountText) {
  const old = document.querySelector('.top-notification');
  if (old) old.remove();
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }

  const dom = document.createElement('div');
  dom.className = 'top-notification';
  dom.innerHTML =
    '<div class="notify-left">' +
      '<div class="notify-icon">$</div>' +
      '<div style="min-width:0;">' +
        '<div class="notify-title">Cash App</div>' +
        '<div class="notify-desc">You paid ' + name + ' $' + amountText + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="notify-right">now</div>';
  document.body.appendChild(dom);

  /* 独立倒计时：固定 2 秒后上滑消失，不受页面切换、Done 影响 */
  state.toastTimer = setTimeout(function () {
    dom.classList.add('hide');
    setTimeout(function () {
      if (dom.parentNode) dom.parentNode.removeChild(dom);
    }, 320);
    state.toastTimer = null;
  }, 2000);
}

/* ================= 余额不足弹窗 ================= */
function showInsufficient() {
  closeAlert();
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.id = 'insufficientOverlay';
  overlay.innerHTML =
    '<div class="alert-box">' +
      '<div class="alert-title">Insufficient Balance</div>' +
      '<div class="alert-desc">You don\'t have enough cash balance to send this payment. Add cash first.</div>' +
      '<button class="alert-btn" onclick="closeAlert()">OK</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

function closeAlert() {
  const el = document.getElementById('insufficientOverlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ================= 回执弹层 ================= */
function openReceipt() {
  const r = state.payRecord;
  if (!r) return;
  const overlay = document.createElement('div');
  overlay.className = 'receipt-overlay';
  overlay.id = 'receiptOverlay';
  overlay.innerHTML =
    '<div class="receipt-box">' +
      '<div class="receipt-title">Receipt</div>' +
      '<div class="receipt-row"><span class="receipt-label">To</span><span class="receipt-value">' + r.targetNick + '</span></div>' +
      '<div class="receipt-row"><span class="receipt-label">Cash ID</span><span class="receipt-value">' + r.targetUid + '</span></div>' +
      '<div class="receipt-row"><span class="receipt-label">Amount</span><span class="receipt-value">$' + money(r.amount) + '</span></div>' +
      '<div class="receipt-row"><span class="receipt-label">Note</span><span class="receipt-value">' + (r.remark || '-') + '</span></div>' +
      '<div class="receipt-row"><span class="receipt-label">Date</span><span class="receipt-value">' + r.time + '</span></div>' +
      '<div class="receipt-row"><span class="receipt-label">Transaction</span><span class="receipt-value">' + r.recordId + '</span></div>' +
      '<div class="receipt-row"><span class="receipt-label">Balance after</span><span class="receipt-value">$' + money(r.balanceAfter) + '</span></div>' +
      '<button class="receipt-close" onclick="closeReceipt()">Done</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

function closeReceipt() {
  const el = document.getElementById('receiptOverlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ================= 菜单 ================= */
function openMenu() {
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.id = 'menuOverlay';
  overlay.innerHTML =
    '<div class="alert-box">' +
      '<div class="alert-title">' + (userInfo.nickname || uid) + '</div>' +
      '<div class="alert-desc">ID: ' + uid + '<br>Cash balance $' + money(userInfo.balance) + '</div>' +
      '<button class="alert-btn" style="background:#2c2c2e;color:#fff;margin-bottom:10px;" onclick="closeMenu()">Close</button>' +
      '<button class="alert-btn" onclick="logout()">Log out</button>' +
    '</div>';
  document.body.appendChild(overlay);
}

function closeMenu() {
  const el = document.getElementById('menuOverlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function logout() {
  localStorage.clear();
  location.replace('/');
}

/* ================= 数据加载 ================= */
async function loadRecords() {
  try {
    const res = await fetch(API + '/user/records/' + encodeURIComponent(uid));
    const data = await res.json();
    records = data.list || [];
  } catch (e) {
    records = [];
  }
}

async function loadSearchHistory() {
  try {
    const res = await fetch(API + '/user/search-history/' + encodeURIComponent(uid));
    const data = await res.json();
    searchHistoryList = data.list || [];
  } catch (e) {
    searchHistoryList = [];
  }
}

async function loadUserCache() {
  try {
    const res = await fetch(API + '/admin/users');
    const data = await res.json();
    window.__userCache = data.list || [];
  } catch (e) {
    window.__userCache = [];
  }
}

async function refreshUserInfo() {
  try {
    const res = await fetch(API + '/user/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, clientId: clientId })
    });
    const data = await res.json();
    if (data.ok && data.user) {
      userInfo = data.user;
      localStorage.setItem('userInfo', JSON.stringify(userInfo));
      return true;
    }
    if (data.msg === 'kicked') {
      kickedOut();
      return false;
    }
  } catch (e) {}
  return false;
}

/* ================= 渲染：首页 ================= */
function renderHome() {
  let historyHtml = '';
  if (records.length === 0) {
    historyHtml = '<div class="history-empty">No payments yet</div>';
  } else {
    records.slice(0, 12).forEach(function (r) {
      historyHtml +=
        '<div class="history-item">' +
          '<div class="history-top">' +
            '<span class="history-person">' + r.targetNick + '</span>' +
            '<span class="history-money">-$' + money(r.amount) + '</span>' +
          '</div>' +
          '<div class="history-sub">' + r.time + (r.remark ? ' · ' + r.remark : '') + '</div>' +
        '</div>';
    });
  }

  return (
    '<div class="home-header">' +
      '<button class="menu-icon" onclick="openMenu()">&#9776;</button>' +
      avatarHtml(userInfo) +
    '</div>' +
    '<div class="amount-display">$' + (state.amount === '' ? '0' : state.amount) + '</div>' +
    '<div class="history-card">' +
      '<div class="history-title">Recent Activity · Balance $' + money(userInfo.balance) + '</div>' +
      historyHtml +
    '</div>' +
    '<div class="keypad">' +
      '<button class="key-btn" onclick="inputNum(\'1\')">1</button>' +
      '<button class="key-btn" onclick="inputNum(\'2\')">2</button>' +
      '<button class="key-btn" onclick="inputNum(\'3\')">3</button>' +
      '<button class="key-btn" onclick="inputNum(\'4\')">4</button>' +
      '<button class="key-btn" onclick="inputNum(\'5\')">5</button>' +
      '<button class="key-btn" onclick="inputNum(\'6\')">6</button>' +
      '<button class="key-btn" onclick="inputNum(\'7\')">7</button>' +
      '<button class="key-btn" onclick="inputNum(\'8\')">8</button>' +
      '<button class="key-btn" onclick="inputNum(\'9\')">9</button>' +
      '<button class="key-btn" onclick="inputNum(\'.\')">.</button>' +
      '<button class="key-btn" onclick="inputNum(\'0\')">0</button>' +
      '<button class="key-btn" onclick="backspace()">&#9003;</button>' +
      '<button class="key-btn key-pay" onclick="goReceiver()">Pay</button>' +
    '</div>'
  );
}

/* ================= 渲染：收款人搜索 ================= */
function renderReceiver() {
  const q = state.searchInput.trim();

  let resultHtml = '';
  if (q) {
    const matches = (window.__userCache || []).filter(function (u) {
      return (
        u.uid.toLowerCase().indexOf(q.toLowerCase()) > -1 ||
        (u.nickname || '').toLowerCase().indexOf(q.toLowerCase()) > -1
      );
    });
    if (matches.length === 0) {
      resultHtml =
        '<div class="receiver-item" onclick="tryLookup()">' +
          '<div class="receiver-avatar">?</div>' +
          '<div><div class="receiver-name">Search "' + q + '"</div>' +
          '<div class="receiver-uid">Tap to look up this Cash ID</div></div>' +
        '</div>';
    } else {
      matches.slice(0, 8).forEach(function (u) {
        resultHtml +=
          '<div class="receiver-item" onclick="pickReceiver(\'' + u.uid + '\')">' +
            avatarHtml(u, 'receiver-avatar') +
            '<div><div class="receiver-name">' + (u.nickname || u.uid) + '</div>' +
            '<div class="receiver-uid">' + u.uid + '</div></div>' +
          '</div>';
      });
    }
  } else {
    resultHtml = '<div class="history-empty" style="padding:22px 0;">Type a Cash ID or name</div>';
  }

  let historyHtml = '';
  if (searchHistoryList.length > 0) {
    historyHtml =
      '<div style="padding:14px 0 4px;color:#8a8a8e;font-size:13px;font-weight:600;">Recent</div>' +
      searchHistoryList.map(function (h) {
        return (
          '<div class="receiver-item" onclick="pickReceiver(\'' + h + '\')" style="padding:10px 12px;">' +
            '<div class="receiver-avatar" style="width:34px;height:34px;font-size:13px;">' + h.slice(0, 1).toUpperCase() + '</div>' +
            '<div class="receiver-name" style="font-size:15px;">' + h + '</div>' +
          '</div>'
        );
      }).join('');
  }

  return (
    '<div class="home-header">' +
      '<button class="menu-icon" onclick="openMenu()">&#9776;</button>' +
      avatarHtml(userInfo) +
    '</div>' +
    '<div class="page-receiver">' +
      '<div class="page-title">Pay</div>' +
      '<input id="searchInput" class="search-box" type="text" autocomplete="off" ' +
        'placeholder="Search name or $Cashtag" value="' + state.searchInput + '" ' +
        'oninput="onSearchInput(this.value)">' +
      '<div class="hint-text">Amount to send: $' + (state.amount || '0') + '</div>' +
      '<div class="receiver-list">' + resultHtml + historyHtml + '</div>' +
    '</div>' +
    '<div class="keypad" style="grid-template-columns:1fr;">' +
      '<button class="key-btn" onclick="backHome()" style="background:#262628;">Cancel</button>' +
    '</div>'
  );
}

/* ================= 渲染：备注页 ================= */
function renderNote() {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  let keys = letters.map(function (ch) {
    return '<button class="text-key" onclick="noteChar(\'' + ch + '\')">' + ch + '</button>';
  }).join('');
  keys +=
    '<button class="text-key wide" onclick="noteChar(\' \')">space</button>' +
    '<button class="text-key wide" onclick="noteBackspace()">del</button>';

  const noteText = state.note
    ? state.note
    : '<span style="color:#666;">Add a note</span>';

  return (
    '<div class="home-header">' +
      '<button class="menu-icon" onclick="openMenu()">&#9776;</button>' +
      avatarHtml(userInfo) +
    '</div>' +
    '<div class="amount-display" style="font-size:38px;padding:4px 20px;">$' + (state.amount || '0') + '</div>' +
    '<div class="modal-wrap">' +
      '<div class="modal-back" onclick="goReceiver()">&#8592; Back</div>' +
      '<div class="modal-title">Pay $' + (state.amount || '0') + ' to</div>' +
      '<div class="receiver-row">' +
        avatarHtml(state.receiver, 'receiver-avatar') +
        '<div class="receiver-name">' + (state.receiver ? state.receiver.nickname : '') + '</div>' +
      '</div>' +
      '<div class="note-display' + (state.note ? '' : ' empty') + '">' + noteText + '</div>' +
      '<div class="text-keypad">' + keys + '</div>' +
      '<button class="continue-btn' + (state.note.trim() ? ' active' : '') + '" onclick="goConfirm()">Continue</button>' +
    '</div>'
  );
}

/* ================= 渲染：确认页 ================= */
function renderConfirm() {
  return (
    '<div class="home-header">' +
      '<button class="menu-icon" onclick="openMenu()">&#9776;</button>' +
      avatarHtml(userInfo) +
    '</div>' +
    '<div class="amount-display" style="font-size:38px;padding:4px 20px;">$' + (state.amount || '0') + '</div>' +
    '<div class="confirm-body">' +
      '<div class="modal-back" onclick="goNote()">&#8592; Back</div>' +
      '<div class="modal-title">Pay $' + (state.amount || '0') + ' to</div>' +
      '<div class="receiver-row">' +
        avatarHtml(state.receiver, 'receiver-avatar') +
        '<div class="receiver-name">' + (state.receiver ? state.receiver.nickname : '') + '</div>' +
      '</div>' +
      '<div class="confirm-note">' + state.note + '</div>' +
      '<div class="style-row">+ Style it</div>' +
      '<div class="balance-row">' +
        '<div class="balance-dot">$</div>' +
        '<div>Cash balance $' + money(userInfo.balance) + '</div>' +
      '</div>' +
      '<div class="tip-text">Payments can\'t be canceled once they\'re sent.</div>' +
      '<button class="pay-btn" onclick="doPay()">Pay</button>' +
    '</div>'
  );
}

/* ================= 渲染：加载页 ================= */
function renderLoading() {
  return (
    '<div class="home-header">' +
      '<button class="menu-icon">&#9776;</button>' +
      avatarHtml(userInfo) +
    '</div>' +
    '<div class="amount-display" style="font-size:38px;padding:4px 20px;">$' + (state.amount || '0') + '</div>' +
    '<div class="loading-wrap">' +
      '<div class="loader"></div>' +
      '<div class="loading-text">Sending payment...</div>' +
    '</div>'
  );
}

/* ================= 渲染：成功页 ================= */
function renderSuccess() {
  return (
    '<div class="page-success">' +
      '<div class="success-check">&#10003;</div>' +
      '<div class="success-text">You sent $' + money(state.amount) + '<br>to ' + (state.receiver ? state.receiver.nickname : '') + '</div>' +
      '<div class="success-sub">Cash balance $' + money(userInfo.balance) + '</div>' +
      '<div class="success-buttons">' +
        '<button class="success-btn" onclick="openReceipt()">Receipt</button>' +
        '<button class="success-btn" style="background:#00d54b;color:#000;" onclick="doneSuccess()">Done</button>' +
      '</div>' +
    '</div>'
  );
}

/* ================= 主渲染 ================= */
function render() {
  let html = '';
  if (state.page === 'home') html = renderHome();
  else if (state.page === 'receiver') html = renderReceiver();
  else if (state.page === 'note') html = renderNote();
  else if (state.page === 'confirm') html = renderConfirm();
  else if (state.page === 'loading') html = renderLoading();
  else if (state.page === 'success') html = renderSuccess();
  app.innerHTML = html;
}

/* ================= 交互 ================= */
function inputNum(n) {
  if (n === '.') {
    if (state.amount.indexOf('.') > -1) return;
    state.amount = (state.amount === '' ? '0' : state.amount) + '.';
    render();
    return;
  }
  if (state.amount.indexOf('.') > -1 && state.amount.split('.')[1].length >= 2) return;
  if (state.amount.replace('.', '').length >= 9) return;
  if (state.amount === '0') {
    state.amount = n;
  } else {
    state.amount = state.amount + n;
  }
  render();
}

function backspace() {
  state.amount = state.amount.slice(0, -1);
  render();
}

function goReceiver() {
  if (!Number(state.amount) || Number(state.amount) <= 0) return;
  state.page = 'receiver';
  state.searchInput = '';
  render();
}

function backHome() {
  state.page = 'home';
  render();
}

function onSearchInput(v) {
  state.searchInput = v;
  render();
  const input = document.getElementById('searchInput');
  if (input) {
    input.focus();
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (e) {}
  }
}

async function tryLookup() {
  const q = state.searchInput.trim();
  if (!q) return;
  const res = await fetch(API + '/user/lookup/' + encodeURIComponent(q));
  const data = await res.json();
  if (!data.ok) {
    const list = document.querySelector('.receiver-list');
    if (list) {
      list.insertAdjacentHTML(
        'afterbegin',
        '<div style="padding:10px 12px;color:#ff6b6b;font-size:14px;">No Cash ID found: ' + q + '</div>'
      );
    }
    return;
  }
  pickReceiver(data.user.uid);
}

async function pickReceiver(targetUid) {
  const res = await fetch(API + '/user/lookup/' + encodeURIComponent(targetUid));
  const data = await res.json();
  if (!data.ok) return;

  state.receiver = data.user;
  state.note = '';
  state.page = 'note';

  fetch(API + '/user/save-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: uid, searchId: data.user.uid })
  }).then(function () { loadSearchHistory(); });

  render();
}

function noteChar(ch) {
  if (state.note.length >= 60) return;
  state.note += ch;
  render();
}

function noteBackspace() {
  state.note = state.note.slice(0, -1);
  render();
}

function goNote() {
  state.page = 'note';
  render();
}

function goConfirm() {
  if (!state.note.trim()) return;
  state.page = 'confirm';
  render();
}

async function doPay() {
  const amountNum = Number(state.amount);
  if (!amountNum || amountNum <= 0) return;

  state.page = 'loading';
  render();

  const started = Date.now();
  let data = { ok: false, msg: 'Network error' };
  try {
    const res = await fetch(API + '/user/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: uid,
        clientId: clientId,
        amount: amountNum,
        remark: state.note,
        targetUid: state.receiver.uid
      })
    });
    data = await res.json();
  } catch (e) {}

  const elapsed = Date.now() - started;
  const wait = Math.max(0, 2400 - elapsed);

  setTimeout(function () {
    if (!data.ok) {
      if (data.msg === 'Insufficient balance') {
        state.page = 'confirm';
        render();
        showInsufficient();
      } else if (data.msg === 'Session expired') {
        kickedOut();
      } else {
        state.page = 'confirm';
        render();
      }
      return;
    }

    userInfo.balance = data.balance;
    localStorage.setItem('userInfo', JSON.stringify(userInfo));
    state.payRecord = data.record;
    state.page = 'success';
    render();

    /* 成功页渲染完成后约 20ms 弹出通知 */
    setTimeout(function () {
      showToast(state.receiver.nickname, money(amountNum));
    }, 20);

    loadRecords();
  }, wait);
}

function doneSuccess() {
  state.amount = '';
  state.note = '';
  state.receiver = null;
  state.payRecord = null;
  state.page = 'home';
  state.searchInput = '';
  render();
}

/* ================= 被踢下线 ================= */
function kickedOut() {
  closeAlert();
  localStorage.clear();
  alert('You have been logged out on another device!');
  location.replace('/');
}

setInterval(async function () {
  const u = localStorage.getItem('uid');
  const c = localStorage.getItem('clientId');
  if (!u || !c) return;
  try {
    const res = await fetch(API + '/user/check-kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: u, clientId: c })
    });
    const d = await res.json();
    if (d.kicked) kickedOut();
  } catch (e) {}
}, 2000);

/* ================= 启动 ================= */
(async function init() {
  await refreshUserInfo();
  await loadUserCache();
  await loadRecords();
  await loadSearchHistory();
  render();
})();
