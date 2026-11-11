const base = "";
let sid = localStorage.getItem("sid");
let currentUser = null;
let state = {
  amount: "",
  targetUser: null,
  note: "",
  balance: 0
};
// 页面阶段：home / search / note / confirm / loading / success
let stage = "home";
let toastTimer = null;

// 检查登录
async function checkLogin() {
  if (!sid) {
    window.location.href = "/index.html";
    return;
  }
  const res = await fetch(`${base}/api/user`, {
    headers: {"x-session-id": sid}
  });
  const data = await res.json();
  if (!data.ok) {
    localStorage.removeItem("sid");
    window.location.href = "/index.html";
    return;
  }
  currentUser = data.user;
  state.balance = currentUser.balance;
  renderStage();
}

// 渲染页面阶段
function renderStage() {
  const wrap = document.getElementById("app-wrap");
  const successWrap = document.getElementById("successWrap");
  const toast = document.getElementById("topToast");
  toast.classList.remove("show", "hide");
  if (toastTimer) clearTimeout(toastTimer);
  successWrap.classList.remove("show");
  wrap.innerHTML = "";
  const kb = document.getElementById("softKeyboard");
  kb.classList.remove("show");

  if (stage === "home") {
    wrap.innerHTML = `
      <div class="amount-display">$${state.amount || "0"}</div>
      <div class="num-keypad">
        <button class="num-key" data-val="1">1</button>
        <button class="num-key" data-val="2">2</button>
        <button class="num-key" data-val="3">3</button>
        <button class="num-key" data-val="4">4</button>
        <button class="num-key" data-val="5">5</button>
        <button class="num-key" data-val="6">6</button>
        <button class="num-key" data-val="7">7</button>
        <button class="num-key" data-val="8">8</button>
        <button class="num-key" data-val="9">9</button>
        <button class="num-key" data-val=".">.</button>
        <button class="num-key" data-val="0">0</button>
        <button class="num-key" data-val="del">⌫</button>
      </div>
      <div class="modal-box shift-down" id="searchModal">
        <div class="search-header">
          <input class="search-input" id="searchId" placeholder="Enter ID">
        </div>
        <div id="searchResult"></div>
      </div>
    `;
    // 数字键盘点击
    document.querySelectorAll(".num-key").forEach(k=>{
      k.onclick = () => {
        const v = k.dataset.val;
        if (v === "del") {
          state.amount = state.amount.slice(0, -1);
        } else {
          state.amount += v;
        }
        renderStage();
      }
    })
    const searchInput = document.getElementById("searchId");
    searchInput.oninput = async () => {
      const tid = searchInput.value.trim();
      const resBox = document.getElementById("searchResult");
      if (!tid) {
        resBox.innerText = "";
        return;
      }
      const r = await fetch(`${base}/api/search-user?id=${tid}`);
      const d = await r.json();
      if (d.ok) {
        resBox.innerHTML = `
          <div class="history-item" id="userSelect">
            <div><strong>${d.user.nickname}</strong> (${d.user.id})</div>
          </div>
        `;
        document.getElementById("userSelect").onclick = () => {
          state.targetUser = d.user;
          state.note = "";
          stage = "note";
          renderStage();
        }
      } else {
        resBox.innerText = "User not found";
      }
    }
  } else if (stage === "note") {
    wrap.innerHTML = `
      <div class="amount-display">$${state.amount}</div>
      <div class="modal-box shift-down" id="noteModal">
        <div style="margin-bottom:16px;">
          <span style="font-size:20px;">Pay ${state.amount} to</span>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <div style="width:40px;height:40px;border-radius:50%;background:#555;overflow:hidden;">
              <!-- 头像预留，后续接入真实API -->
            </div>
            <span style="font-size:22px;">${state.targetUser.nickname}</span>
          </div>
        </div>
        <div class="note-area">
          <input class="note-input" id="noteInput" placeholder="Add a note" value="${state.note}">
        </div>
        <button class="continue-btn ${state.note.trim() ? 'active' : ''}" id="continueBtn">Continue</button>
      </div>
    `;
    const noteInp = document.getElementById("noteInput");
    const modal = document.getElementById("noteModal");
    // 点击备注框，弹出软键盘，弹窗上移
    noteInp.onfocus = () => {
      modal.classList.remove("shift-down");
      modal.classList.add("shift-up");
      kb.classList.add("show");
    }
    // 点击页面其他地方，收起键盘，弹窗下移
    wrap.onclick = (e) => {
      if (!noteInp.contains(e.target) && !kb.contains(e.target)) {
        kb.classList.remove("show");
        modal.classList.remove("shift-up");
        modal.classList.add("shift-down");
      }
    }
    noteInp.oninput = () => {
      state.note = noteInp.value;
      renderStage();
    }
    document.getElementById("continueBtn").onclick = () => {
      if (!state.note.trim()) return;
      stage = "confirm";
      renderStage();
    }
  } else if (stage === "confirm") {
    const amt = Number(state.amount);
    wrap.innerHTML = `
      <div class="amount-display">$${state.amount}</div>
      <div class="modal-box shift-down">
        <div style="margin-bottom:16px;">
          <span style="font-size:20px;">Pay ${state.amount} to</span>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <div style="width:40px;height:40px;border-radius:50%;background:#555;"></div>
            <span style="font-size:22px;">${state.targetUser.nickname}</span>
          </div>
          <div style="margin-top:12px;font-size:24px;">${state.note}</div>
        </div>
        <div class="balance-line">
          <span style="width:24px;height:24px;border-radius:50%;background:#00a862;display:inline-flex;align-items:center;justify-content:center;color:white;">$</span>
          <span>Cash balance $${state.balance.toFixed(2)}</span>
        </div>
        <div style="color:#aaa;font-size:13px;margin-bottom:20px;">Payments can't be canceled once they're sent.</div>
        <button class="pay-btn" id="payBtn">Pay</button>
      </div>
      <div class="alert-modal" id="alertModal">
        <div class="alert-box">
          <h3>Insufficient balance</h3>
          <p>You don't have enough balance to complete this payment.</p>
          <button id="closeAlert">OK</button>
        </div>
      </div>
    `;
    document.getElementById("closeAlert").onclick = () => {
      document.getElementById("alertModal").classList.remove("show");
    }
    document.getElementById("payBtn").onclick = async () => {
      if (state.balance < amt) {
        document.getElementById("alertModal").classList.add("show");
        return;
      }
      stage = "loading";
      renderStage();
      // 模拟 2~3 秒加载
      const loadTime = 2000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, loadTime));
      // 提交扣款
      const res = await fetch(`${base}/api/pay`, {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "x-session-id": sid
        },
        body: JSON.stringify({
          amount: amt,
          note: state.note,
          targetId: state.targetUser.id
        })
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.msg);
        stage = "confirm";
        renderStage();
        return;
      }
      state.balance = data.newBalance;
      stage = "success";
      renderStage();
    }
  } else if (stage === "loading") {
    wrap.innerHTML = `
      <div class="amount-display">$${state.amount}</div>
      <div class="modal-box shift-down">
        <div class="loader-wrap">
          <div class="spinner"></div>
        </div>
      </div>
    `
  } else if (stage === "success") {
    const successWrap = document.getElementById("successWrap");
    successWrap.classList.add("show");
    successWrap.innerHTML = `
      <div class="success-check">✓</div>
      <div class="success-text">You sent $${state.amount} to ${state.targetUser.nickname}</div>
      <div class="success-buttons">
        <button id="receiptBtn">Receipt</button>
        <button id="doneBtn">Done</button>
      </div>
    `
    // 20ms 后弹出顶部通知，独立计时 2s
    setTimeout(()=>{
      const toast = document.getElementById("topToast");
      const now = new Date().toLocaleTimeString();
      toast.innerHTML = `
        <div class="toast-header">
          <span>Cash App</span>
          <span>now</span>
        </div>
        <div class="toast-body">You paid ${state.targetUser.nickname} $${state.amount}</div>
      `
      toast.classList.add("show");
      toastTimer = setTimeout(()=>{
        toast.classList.remove("show");
        toast.classList.add("hide");
      }, 2000);
    }, 20);
    document.getElementById("doneBtn").onclick = () => {
      state.amount = "";
      state.targetUser = null;
      state.note = "";
      stage = "home";
      renderStage();
    }
    document.getElementById("receiptBtn").onclick = () => {
      alert(`Receipt: Send $${state.amount} to ${state.targetUser.nickname}, note: ${state.note}`);
    }
  }
}

// 软键盘渲染
function buildSoftKeyboard() {
  const kb = document.getElementById("softKeyboard");
  const rows = [
    "q w e r t y u i o p",
    "a s d f g h j k l",
    "z x c v b n m",
    "  del enter"
  ]
  kb.innerHTML = "";
  rows.forEach(rowStr=>{
    const rowDiv = document.createElement("div");
    rowDiv.className = "key-row";
    rowStr.split(" ").forEach(k=>{
      const btn = document.createElement("button");
      btn.className = "soft-key";
      if (k === "del") btn.classList.add("del");
      if (k === "enter") btn.classList.add("enter");
      btn.innerText = k === "del" ? "⌫" : k === "enter" ? "✓" : k;
      btn.onclick = () => {
        const noteInp = document.getElementById("noteInput");
        if (!noteInp) return;
        if (k === "del") {
          noteInp.value = noteInp.value.slice(0,-1);
        } else if (k === "enter") {
          // 确认
        } else {
          noteInp.value += k;
        }
        state.note = noteInp.value;
        renderStage();
      }
      rowDiv.appendChild(btn);
    })
    kb.appendChild(rowDiv);
  })
}

// 主入口
window.onload = async () => {
  buildSoftKeyboard();
  await checkLogin();
}
