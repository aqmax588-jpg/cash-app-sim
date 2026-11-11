// ========== 本地模拟数据，本地跑测试用 ==========
const mockData = {
  account: {
    id: "acc_001",
    balance: 100000.00
  },
  receiverList: [
    { id: "rose", name: "rose", avatar: "R" },
    { id: "alice", name: "alice", avatar: "A" },
    { id: "bob", name: "bob", avatar: "B" }
  ]
};

const state = {
  account: { ...mockData.account },
  amount: "",
  receiver: null,
  note: "",
  page: "home",
  notifyTimer: null
};
const $ = (id) => document.getElementById(id);
const pageWrap = $("pageWrap");
const topNotify = $("topNotification");
const appRoot = $("app");

// 顶部通知：独立计时器
function showNotification(payTo, amount) {
  clearTimeout(state.notifyTimer);
  topNotify.querySelector(".notify-text").innerText = `You paid ${payTo} $${amount}.`;
  topNotify.classList.remove("hide-animate");
  topNotify.classList.add("active");
  state.notifyTimer = setTimeout(() => {
    topNotify.classList.remove("active");
    topNotify.classList.add("hide-animate");
  }, 2000);
}

// 首页金额键盘
function renderHome() {
  state.page = "home";
  pageWrap.innerHTML = `
  <div class="page-home">
    <div class="home-header">
      <div class="menu-icon">☰</div>
      <div class="avatar-circle">U</div>
    </div>
    <div class="amount-display">$${state.amount || "0"}</div>
    <div class="keypad">
      <button class="key-btn" onclick="inputNum('1')">1</button>
      <button class="key-btn" onclick="inputNum('2')">2</button>
      <button class="key-btn" onclick="inputNum('3')">3</button>
      <button class="key-btn" onclick="inputNum('4')">4</button>
      <button class="key-btn" onclick="inputNum('5')">5</button>
      <button class="key-btn" onclick="inputNum('6')">6</button>
      <button class="key-btn" onclick="inputNum('7')">7</button>
      <button class="key-btn" onclick="inputNum('8')">8</button>
      <button class="key-btn" onclick="inputNum('9')">9</button>
      <button class="key-btn" onclick="inputDot()">.</button>
      <button class="key-btn" onclick="inputNum('0')">0</button>
      <button class="key-btn" onclick="backspace()">←</button>
      <button class="key-btn key-pay" onclick="goReceiver()">Pay</button>
    </div>
  </div>
  `;
}
window.inputNum = function (n) {
  if (state.amount.includes(".") && state.amount.split(".")[1].length >= 2) return;
  state.amount += n;
  renderHome();
};
window.inputDot = function () {
  if (!state.amount.includes(".")) {
    state.amount += ".";
  }
  renderHome();
};
window.backspace = function () {
  state.amount = state.amount.slice(0, -1);
  renderHome();
};
window.goReceiver = function () {
  renderReceiverSelect();
};

// 收款人选择页
window.renderReceiverSelect = function () {
  state.page = "receiver";
  let receiverHtml = "";
  mockData.receiverList.forEach(item => {
    receiverHtml += `
      <div class="receiver-item" onclick="selectReceiver('${item.id}','${item.name}','${item.avatar}')">
        <div class="receiver-avatar">${item.avatar}</div>
        <div class="receiver-name">${item.name}</div>
      </div>
    `;
  });
  pageWrap.innerHTML = `
  <div class="page-receiver">
    <input class="search-box" placeholder="Search name or $Cashtag" readonly>
    ${receiverHtml}
  </div>
  `;
};
window.selectReceiver = function (id, name, avatar) {
  state.receiver = { id, name, avatar };
  renderNoteModal();
};

// 备注弹窗 + 自定义文字键盘（不会唤起系统键盘）
window.renderNoteModal = function () {
  state.page = "note";
  pageWrap.innerHTML = `
  <div class="page-home">
    <div class="home-header">
      <div class="menu-icon">☰</div>
      <div class="avatar-circle">U</div>
    </div>
    <div class="amount-display">$${state.amount || "0"}</div>
    <div class="modal-wrap">
      <div class="modal-back" onclick="renderReceiverSelect()">←</div>
      <div class="modal-title">Pay ${state.amount} to</div>
      <div class="receiver-row">
        <div class="receiver-avatar">${state.receiver.avatar}</div>
        <div class="receiver-name">${state.receiver.name}</div>
      </div>
      <div class="note-display">${state.note || "Add a note"}</div>
      <div class="text-keypad">
        <button class="text-key" onclick="noteChar('a')">a</button>
        <button class="text-key" onclick="noteChar('b')">b</button>
        <button class="text-key" onclick="noteChar('c')">c</button>
        <button class="text-key" onclick="noteChar('d')">d</button>
        <button class="text-key" onclick="noteChar('e')">e</button>
        <button class="text-key" onclick="noteChar('f')">f</button>
        <button class="text-key" onclick="noteChar('g')">g</button>
        <button class="text-key" onclick="noteChar('h')">h</button>
        <button class="text-key" onclick="noteChar('i')">i</button>
        <button class="text-key" onclick="noteChar('j')">j</button>
        <button class="text-key" onclick="noteChar('k')">k</button>
        <button class="text-key" onclick="noteChar('l')">l</button>
        <button class="text-key" onclick="noteChar('m')">m</button>
        <button class="text-key" onclick="noteChar('n')">n</button>
        <button class="text-key" onclick="noteChar('o')">o</button>
        <button class="text-key" onclick="noteChar('p')">p</button>
        <button class="text-key" onclick="noteChar('q')">q</button>
        <button class="text-key" onclick="noteChar('r')">r</button>
        <button class="text-key" onclick="noteChar('s')">s</button>
        <button class="text-key" onclick="noteChar('t')">t</button>
        <button class="text-key" onclick="noteChar('u')">u</button>
        <button class="text-key" onclick="noteChar('v')">v</button>
        <button class="text-key" onclick="noteChar('w')">w</button>
        <button class="text-key" onclick="noteChar('x')">x</button>
        <button class="text-key" onclick="noteChar('y')">y</button>
        <button class="text-key" onclick="noteChar('z')">z</button>
        <button class="text-key" onclick="noteChar(' ')">空格</button>
        <button class="text-key" onclick="noteBackspace()">删除</button>
      </div>
      <button class="continue-btn ${state.note.trim() ? 'active' : ''}" id="continueBtn" onclick="goConfirm()">Continue</button>
    </div>
  </div>
  `;
};
// 备注输入函数
window.noteChar = function (ch) {
  state.note += ch;
  renderNoteModal();
};
window.noteBackspace = function () {
  state.note = state.note.slice(0, -1);
  renderNoteModal();
};
window.goConfirm = function () {
  if (!state.note.trim()) return;
  renderConfirm();
};

// 确认支付页
window.renderConfirm = function () {
  state.page = "confirm";
  pageWrap.innerHTML = `
  <div class="page-home">
    <div class="home-header">
      <div class="menu-icon">☰</div>
      <div class="avatar-circle">U</div>
    </div>
    <div class="amount-display">$${state.amount || "0"}</div>
    <div class="modal-wrap">
      <div class="modal-back" onclick="renderNoteModal()">←</div>
      <div class="modal-title">Pay ${state.amount} to</div>
      <div class="receiver-row">
        <div class="receiver-avatar">${state.receiver.avatar}</div>
        <div class="receiver-name">${state.receiver.name}</div>
      </div>
      <div style="color:#fff;font-size:28px;font-weight:bold;margin-bottom:16px;">${state.note}</div>
      <div class="style-row">+ Style it</div>
      <div class="balance-row">
        <div class="balance-dot">$</div>
        <div>Cash balance $${Number(state.account.balance).toFixed(2)}</div>
      </div>
      <div class="tip-text">Payments can't be canceled once they're sent.</div>
      <button class="pay-btn" onclick="paySubmit()">Pay</button>
    </div>
  </div>
  `;
};
window.paySubmit = function () {
  renderLoading();
  // 模拟加载 2.5s
  setTimeout(() => {
    const payVal = Number(state.amount);
    // 本地扣余额
    state.account.balance = state.account.balance - payVal;
    const paymentId = "pay_" + Date.now();
    renderSuccess(paymentId);
    setTimeout(() => {
      showNotification(state.receiver.name, state.amount);
    }, 20);
  }, 2500);
};

// 加载页
window.renderLoading = function () {
  state.page = "loading";
  pageWrap.innerHTML = `
  <div class="page-home">
    <div class="home-header">
      <div class="menu-icon">☰</div>
      <div class="avatar-circle">U</div>
    </div>
    <div class="amount-display">$${state.amount || "0"}</div>
    <div class="modal-wrap">
      <div class="modal-loading">
        <div class="loader"></div>
      </div>
    </div>
  </div>
  `;
};

// 成功页
window.renderSuccess = function (paymentId) {
  state.page = "success";
  pageWrap.innerHTML = `
  <div class="page-success">
    <div class="success-check">✓</div>
    <div class="success-text">You sent $${Number(state.amount).toFixed(2)} to ${state.receiver.name}</div>
    <div class="success-buttons">
      <button class="success-btn" onclick="openReceipt('${paymentId}')">Receipt</button>
      <button class="success-btn" onclick="doneAction()">Done</button>
    </div>
  </div>
  `;
};
window.openReceipt = function (paymentId) {
  alert("Receipt popup, paymentId: " + paymentId);
};
window.doneAction = function () {
  state.amount = "";
  state.note = "";
  state.receiver = null;
  renderHome();
};

// 启动
renderHome();
