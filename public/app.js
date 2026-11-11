const uid = localStorage.getItem("uid");
if (!uid) location.href = "/";
let userInfo = JSON.parse(localStorage.getItem("userInfo"));
let currentAmount = "";
let targetUser = null;
let remarkText = "";
let pageState = 0;
let searchHistoryList = [];
// 通知计时器，独立变量，不受页面切换影响
let toastTimer = null;
let toastDom = null;

async function loadSearchHistory() {
  const res = await fetch(`/api/user/search-history/${uid}`);
  searchHistoryList = await res.json();
}
loadSearchHistory();

// 弹出顶部通知，独立计时，2 秒后上滑消失
function showIndependentToast(payName, payAmount) {
  // 清除旧定时器
  if (toastTimer) clearTimeout(toastTimer);
  const oldNotify = document.querySelector(".top-notification");
  if (oldNotify) oldNotify.remove();

  const notify = document.createElement("div");
  notify.className = "top-notification";
  notify.innerHTML = `
    <div class="notify-left">
      <div class="notify-icon">$</div>
      <div>
        <div class="notify-title">Cash App</div>
        <div class="notify-desc">You paid ${payName} $${payAmount}</div>
      </div>
    </div>
    <div class="notify-right">now</div>
  `;
  document.body.appendChild(notify);
  toastDom = notify;
  // 固定 2 秒倒计时，独立运行，不管页面怎么切
  toastTimer = setTimeout(() => {
    notify.classList.add("hide");
    setTimeout(() => notify.remove(), 300);
  }, 2000);
}

function render() {
  const app = document.getElementById("app");
  if (pageState === 0) {
    app.innerHTML = `
      <div class="page active">
        <div class="amount-title">$${currentAmount}</div>
        <div class="num-keyboard-wrap">
          <div class="num-keyboard">
            <button class="key-btn" onclick="inputNum('1')">1</button>
            <button class="key-btn" onclick="inputNum('2')">2</button>
            <button class="key-btn" onclick="inputNum('3')">3</button>
            <button class="key-btn" onclick="inputNum('4')">4</button>
            <button class="key-btn" onclick="inputNum('5')">5</button>
            <button class="key-btn" onclick="inputNum('6')">6</button>
            <button class="key-btn" onclick="inputNum('7')">7</button>
            <button class="key-btn" onclick="inputNum('8')">8</button>
            <button class="key-btn" onclick="inputNum('9')">9</button>
            <button class="key-btn" onclick="inputNum('.')">.</button>
            <button class="key-btn" onclick="inputNum('0')">0</button>
            <button class="key-btn pay" onclick="goSearch()">Pay</button>
          </div>
        </div>
      </div>
    `;
  } else if (pageState === 1) {
    app.innerHTML = `
      <div class="page active">
        <div class="popup">
          <h3>Search ID</h3>
          <input class="custom-input" id="searchId" placeholder="Enter ID">
          <div style="margin-top:12px;">
            <p style="margin-bottom:8px;color:#aaa;">History</p>
            ${searchHistoryList.map(h => `<div style="padding:8px 0;color:#fff;" onclick="selectHistory('${h}')">${h}</div>`).join("")}
          </div>
        </div>
        <div class="num-keyboard-wrap">
          <div class="num-keyboard">
            <button class="key-btn" onclick="inputSearchChar('1')">1</button>
            <button class="key-btn" onclick="inputSearchChar('2')">2</button>
            <button class="key-btn" onclick="inputSearchChar('3')">3</button>
            <button class="key-btn" onclick="inputSearchChar('4')">4</button>
            <button class="key-btn" onclick="inputSearchChar('5')">5</button>
            <button class="key-btn" onclick="inputSearchChar('6')">6</button>
            <button class="key-btn" onclick="inputSearchChar('7')">7</button>
            <button class="key-btn" onclick="inputSearchChar('8')">8</button>
            <button class="key-btn" onclick="inputSearchChar('9')">9</button>
            <button class="key-btn" onclick="inputSearchChar('.')">.</button>
            <button class="key-btn" onclick="inputSearchChar('0')">0</button>
            <button class="key-btn pay" onclick="doSearch()">✓</button>
          </div>
        </div>
      </div>
    `;
  } else if (pageState === 2) {
    if (targetUser) {
      app.innerHTML = `
        <div class="page active">
          <div class="popup">
            <img class="avatar" src="${targetUser.avatar}" alt="avatar">
            <p style="font-size:20px;color:#fff;">${targetUser.nickname}</p>
            <p style="color:#aaa;">ID: ${targetUser.uid}</p>
          </div>
          <div class="popup">
            <h3>Remark</h3>
            <input class="custom-input" id="remarkInput" placeholder="Add remark" value="${remarkText}">
            <button class="continue" onclick="goConfirm()">Continue</button>
          </div>
        </div>
      `;
    } else {
      app.innerHTML = `
        <div class="page active">
          <div class="popup">
            <p style="color:#fff;">No user found with this ID</p>
            <button style="margin-top:12px;padding:10px;border-radius:8px;background:#00d54b;color:#000;border:none;" onclick="pageState=1;render()">Back</button>
          </div>
        </div>
      `;
    }
  } else if (pageState === 3) {
    app.innerHTML = `
      <div class="page active">
        <div class="popup">
          <h3>Confirm Payment</h3>
          <p style="margin:6px 0;color:#fff;">To: ${targetUser.nickname}</p>
          <p style="margin:6px 0;color:#fff;">Amount: $${currentAmount}</p>
          <p style="margin:6px 0;color:#fff;">Your Balance: $${userInfo.balance.toLocaleString()}</p>
          <p style="margin:6px 0;color:#fff;">Remark: ${remarkText || "-"}</p>
          <button class="continue" onclick="doPay()">Pay</button>
        </div>
      </div>
    `;
  } else if (pageState === 4) {
    app.innerHTML = `
      <div class="page active">
        <div class="loading-circle"></div>
      </div>
    `;
    setTimeout(async () => {
      const payRes = await fetch("/api/user/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid,
          amount: Number(currentAmount),
          remark: remarkText,
          targetId: targetUser.uid,
          targetNick: targetUser.nickname,
          targetAvatar: targetUser.avatar
        })
      });
      const data = await payRes.json();
      if (!data.ok) {
        pageState = 5;
        render();
      } else {
        userInfo.balance = data.user.balance;
        localStorage.setItem("userInfo", JSON.stringify(userInfo));
        pageState = 6;
        render();
        // 成功页面渲染后约 20ms 弹出通知，独立计时
        setTimeout(() => {
          showIndependentToast(targetUser.nickname, currentAmount);
        }, 20);
      }
    }, 2500);
  } else if (pageState === 5) {
    app.innerHTML = `
      <div class="page active">
        <div class="popup">
          <h3>Payment Failed</h3>
          <p style="margin:8px 0;color:#fff;">Insufficient balance</p>
          <button style="margin-top:12px;padding:10px;border-radius:8px;background:#00d54b;color:#000;border:none;" onclick="pageState=0;currentAmount='';targetUser=null;remarkText='';render()">Done</button>
        </div>
      </div>
    `;
  } else if (pageState === 6) {
    app.innerHTML = `
      <div class="page active">
        <div class="popup">
          <h3>Payment Success</h3>
          <p style="margin:8px 0;color:#fff;">Paid $${currentAmount} to ${targetUser.nickname}</p>
          <button class="continue" onclick="doneSuccess()">Done</button>
        </div>
      </div>
    `;
  }
}

// Done 按钮：只切页面，不影响通知定时器
function doneSuccess() {
  pageState = 0;
  currentAmount = "";
  targetUser = null;
  remarkText = "";
  render();
}

function inputNum(c) {
  currentAmount += c;
  render();
}
function goSearch() {
  pageState = 1;
  render();
}
function selectHistory(id) {
  document.getElementById("searchId").value = id;
  doSearch();
}
function inputSearchChar(c) {
  const el = document.getElementById("searchId");
  el.value += c;
}
async function doSearch() {
  const sid = document.getElementById("searchId").value.trim();
  await fetch("/api/user/save-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, searchId: sid })
  });
  targetUser = {
    uid: sid,
    nickname: "User " + sid,
    avatar: "https://via.placeholder.com/128/00d54b/000000?text=AV"
  };
  pageState = 2;
  render();
}
function goConfirm() {
  remarkText = document.getElementById("remarkInput").value.trim();
  pageState = 3;
  render();
}
async function doPay() {
  pageState = 4;
  render();
}

render();

// 轮询检测被踢下线
setInterval(async () => {
  const uidVal = localStorage.getItem("uid");
  const cid = localStorage.getItem("clientId");
  if (!uidVal || !cid) return;
  const r = await fetch("/api/user/check-kick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: uidVal, clientId: cid })
  });
  const d = await r.json();
  if (d.kicked) {
    alert("You have been logged out on another device!");
    localStorage.clear();
    location.href = "/";
  }
}, 2000);
