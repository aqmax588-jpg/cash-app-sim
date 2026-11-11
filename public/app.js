(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KBH = 232; // 自定义键盘高度 px
  const SHEETS = ["searchSheet", "noteSheet", "confirmSheet", "loadingSheet"];

  let sid = localStorage.getItem("sid") || "";
  let balance = 1850000;
  let amountStr = "0";
  let targetUser = null;
  let noteStr = "";
  let searchStr = "";
  let kbOpen = false;
  let kbTarget = null;

  /* ---------------- 历史联系人（本地模拟库） ---------------- */
  const HISTORY = [
    { id: "rose",     name: "rose", tag: "$rose",     color: "#7BD3A8" },
    { id: "alex",     name: "Alex", tag: "$alex",     color: "#C7A3E0" },
    { id: "mike",     name: "Mike", tag: "$mike",     color: "#93B7E8" },
    { id: "demo001",  name: "rose", tag: "$demo001",  color: "#7BD3A8" }
  ];

  /* ---------------- 金额格式化 ---------------- */
  function money(s) {
    const p = String(s).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }

  function renderAmount() {
    $("amountText").textContent = "$" + money(amountStr);
    $("searchTitle").textContent = "Pay $" + money(amountStr);
    $("searchPayTo").textContent = "Pay " + money(amountStr) + " to";
    $("notePayTo").textContent = "Pay " + money(amountStr) + " to";
    $("confirmPayTo").textContent = "Pay " + money(amountStr) + " to";
  }

  function renderBalance() {
    $("balanceText").textContent = "$" + money(Number(balance).toFixed(2));
  }

  /* ---------------- 弹窗控制 ---------------- */
  function showSheet(name) {
    $("sheetLayer").classList.add("open");
    SHEETS.forEach((id) => $(id).classList.toggle("open", id === name));
  }

  function hideSheets() {
    $("sheetLayer").classList.remove("open");
    SHEETS.forEach((id) => $(id).classList.remove("open"));
    closeKb();
  }

  /* ---------------- 自定义键盘 ---------------- */
  function setKbHeight(h) {
    document.documentElement.style.setProperty("--kb-h", h + "px");
  }

  function buildKb() {
    const kb = $("softKb");
    const rows = [
      ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
      ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
      ["z", "x", "c", "v", "b", "n", "m"],
      ["del", "space", "ok"]
    ];
    kb.innerHTML = "";
    rows.forEach((row) => {
      const r = document.createElement("div");
      r.className = "kb-row";
      row.forEach((k) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "kb-key";
        if (k === "ok") b.classList.add("kb-ok");
        else if (k === "del") b.classList.add("kb-del");
        else if (k === "space") b.classList.add("kb-space");
        b.textContent = k === "del" ? "⌫" : k === "ok" ? "✓" : k === "space" ? "space" : k;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onKbKey(k);
        });
        r.appendChild(b);
      });
      kb.appendChild(r);
    });
  }

  function openKb(target) {
    kbTarget = target;
    kbOpen = true;
    setKbHeight(KBH);
    $("softKb").classList.add("open");
  }

  function closeKb() {
    kbOpen = false;
    kbTarget = null;
    setKbHeight(0);
    $("softKb").classList.remove("open");
  }

  function onKbKey(k) {
    if (k === "ok") {
      closeKb();
      return;
    }
    if (k === "del") {
      if (kbTarget === "search") {
        searchStr = searchStr.slice(0, -1);
        $("searchInput").value = searchStr;
        renderResults();
      } else if (kbTarget === "note") {
        noteStr = noteStr.slice(0, -1);
        $("noteInput").value = noteStr;
        updateContinue();
      }
      return;
    }
    const ch = k === "space" ? " " : k;
    if (kbTarget === "search") {
      searchStr += ch;
      $("searchInput").value = searchStr;
      renderResults();
    } else if (kbTarget === "note") {
      if (noteStr.length >= 24) return;
      noteStr += ch;
      $("noteInput").value = noteStr;
      updateContinue();
    }
  }

  /* ---------------- 搜索结果 ---------------- */
  function makeAvatar(user, size) {
    const d = document.createElement("div");
    d.className = "avatar" + (size === "small" ? " avatar-sm" : "");
    d.style.background = user.color || "#7BD3A8";
    d.textContent = (user.name || "?").charAt(0).toUpperCase();
    return d;
  }

  function makeRow(user) {
    const row = document.createElement("div");
    row.className = "result-row";

    const av = makeAvatar(user);

    const info = document.createElement("div");
    info.className = "result-info";

    const n = document.createElement("div");
    n.className = "result-name";
    n.textContent = user.name;

    if (user.demo) {
      const tag = document.createElement("span");
      tag.className = "demo-tag";
      tag.textContent = "DEMO";
      n.appendChild(tag);
    }

    const t = document.createElement("div");
    t.className = "result-tag";
    t.textContent = user.tag;

    info.appendChild(n);
    info.appendChild(t);
    row.appendChild(av);
    row.appendChild(info);

    row.addEventListener("click", () => pickUser(user));
    return row;
  }

  function makeMockUser(q) {
    const raw = q.replace(/^\$/g, "").replace(/\s+/g, "") || "demo";
    const shown = raw.charAt(0).toUpperCase() + raw.slice(1);
    return {
      id: raw,
      name: shown,
      tag: "$" + raw,
      color: "#8FD0A8",
      demo: true
    };
  }

  function renderResults() {
    const list = $("resultsList");
    list.innerHTML = "";

    const q = searchStr.trim().replace(/^\$/g, "").toLowerCase();

    // 未输入：展示全部历史
    if (!q) {
      HISTORY.forEach((u) => list.appendChild(makeRow(u)));
      return;
    }

    const matched = HISTORY.filter(
      (u) =>
        u.id.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.tag.toLowerCase().includes(q)
    );

    if (matched.length) {
      matched.forEach((u) => list.appendChild(makeRow(u)));
      return;
    }

    // 无匹配：No results + 虚拟联系人，保证可以继续
    const tip = document.createElement("div");
    tip.className = "no-results";
    tip.textContent = "No results";
    list.appendChild(tip);

    const hint = document.createElement("div");
    hint.className = "no-hint";
    hint.textContent = "No such Cashtag in history. Tap the demo contact below to continue the test flow.";
    list.appendChild(hint);

    list.appendChild(makeRow(makeMockUser(searchStr)));
  }

  /* ---------------- 选中收款人 ---------------- */
  function pickUser(user) {
    targetUser = user;
    noteStr = "";
    $("noteInput").value = "";
    $("noteName").textContent = user.name;

    const av = $("noteAvatar");
    av.textContent = (user.name || "?").charAt(0).toUpperCase();
    av.style.background = user.color || "#7BD3A8";

    const cav = $("confirmAvatar");
    cav.textContent = (user.name || "?").charAt(0).toUpperCase();
    cav.style.background = user.color || "#7BD3A8";
    $("confirmName").textContent = user.name;

    updateContinue();
    closeKb();
    showSheet("noteSheet");
  }

  function updateContinue() {
    const b = $("continueBtn");
    if (noteStr.trim()) {
      b.disabled = false;
      b.classList.add("active");
    } else {
      b.disabled = true;
      b.classList.remove("active");
    }
  }

  /* ---------------- 主页数字键盘 ---------------- */
  function pressNum(k) {
    if (k === "del") {
      amountStr = amountStr.length > 1 ? amountStr.slice(0, -1) : "0";
    } else if (k === ".") {
      if (!amountStr.includes(".")) amountStr += ".";
    } else {
      if (amountStr.includes(".")) {
        const dec = amountStr.split(".")[1] || "";
        if (dec.length >= 2) return;
      }
      amountStr = amountStr === "0" ? k : amountStr + k;
    }
    if (amountStr.length > 12) amountStr = amountStr.slice(0, 12);
    renderAmount();
  }

  /* ---------------- 顶部通知 ---------------- */
  function showToast(amt) {
    $("toastBody").textContent =
      "You paid " + targetUser.name + " $" + money(Number(amt).toFixed(2));
    $("toast").classList.add("show");

    // 独立计时，2 秒后上滑消失，不受 Done 影响
    setTimeout(() => {
      $("toast").classList.remove("show");
    }, 2000);
  }

  /* ---------------- 成功页 ---------------- */
  function showSuccess(amt) {
    $("successText").textContent =
      "You sent $" + money(Number(amt).toFixed(2)) + " to " + targetUser.name;
    $("successScreen").classList.add("open");

    // 出现 20ms 后弹出顶部通知
    setTimeout(() => showToast(amt), 20);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 数字键盘
    $("numkeypad").addEventListener("click", (e) => {
      const btn = e.target.closest(".numkey");
      if (!btn) return;
      pressNum(btn.dataset.key);
    });

    // 首页 Pay → 弹出搜索弹窗
    $("payEntry").addEventListener("click", () => {
      const v = parseFloat(amountStr);
      if (!v || v <= 0) {
        alert("Please enter an amount first");
        return;
      }
      searchStr = "";
      $("searchInput").value = "";
      renderResults();
      renderAmount();
      showSheet("searchSheet");
    });

    // 关闭搜索
    $("closeSearch").addEventListener("click", () => {
      hideSheets();
    });

    // 搜索框点击 → 弹出键盘
    $("searchInput").addEventListener("click", () => {
      openKb("search");
    });

    // 清除搜索
    $("searchClear").addEventListener("click", (e) => {
      e.stopPropagation();
      searchStr = "";
      $("searchInput").value = "";
      renderResults();
    });

    // 备注框点击 → 弹出键盘（弹窗上移）
    $("noteInput").addEventListener("click", () => {
      openKb("note");
    });

    // 弹窗层空白处点击 → 收起键盘（点输入框不收起）
    $("sheetLayer").addEventListener("pointerdown", (e) => {
      if (!kbOpen) return;
      if (e.target.closest(".soft-kb")) return;
      if (e.target.closest("#searchInput") || e.target.closest("#noteInput")) return;
      closeKb();
    });

    // 备注页返回
    $("noteBack").addEventListener("click", () => {
      closeKb();
      showSheet("searchSheet");
    });

    // Continue → 确认支付
    $("continueBtn").addEventListener("click", () => {
      if (!noteStr.trim()) return;
      closeKb();
      $("confirmNote").textContent = noteStr;
      renderBalance();
      showSheet("confirmSheet");
    });

    // + Style it（占位）
    $("styleBtn").addEventListener("click", () => {
      noteStr = noteStr + " ✨";
      $("confirmNote").textContent = noteStr;
    });

    // 确认支付
    $("confirmPay").addEventListener("click", () => {
      const amt = parseFloat(amountStr);

      // 余额校验
      if (Number(balance) < amt) {
        $("alertMask").classList.add("open");
        return;
      }

      showSheet("loadingSheet");

      const wait = 2000 + Math.random() * 1000;
      setTimeout(async () => {
        try {
          const r = await fetch("/api/pay", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-session-id": sid
            },
            body: JSON.stringify({
              amount: amt,
              note: noteStr,
              targetId: targetUser.id
            })
          });
          const d = await r.json();
          if (d.ok) balance = d.newBalance;
          else balance = Number(balance) - amt;
        } catch (err) {
          // 后端不可用时本地扣减，保证演示不中断
          balance = Number(balance) - amt;
        }
        if (balance < 0) balance = 0;
        renderBalance();
        hideSheets();
        $("homeScreen").style.display = "none";
        showSuccess(amt);
      }, wait);
    });

    // 余额不足提示
    $("alertOk").addEventListener("click", () => {
      $("alertMask").classList.remove("open");
    });

    // Receipt
    $("receiptBtn").addEventListener("click", () => {
      alert(
        "Receipt\n\nTo: " + targetUser.name + " (" + targetUser.tag + ")\n" +
        "Amount: $" + money(Number(amountStr).toFixed(2)) + "\n" +
        "Note: " + noteStr + "\n" +
        "Status: Completed"
      );
    });

    // Done → 回到最初界面（不影响 toast 计时）
    $("doneBtn").addEventListener("click", () => {
      $("successScreen").classList.remove("open");
      $("homeScreen").style.display = "flex";

      amountStr = "0";
      targetUser = null;
      noteStr = "";
      searchStr = "";

      $("noteInput").value = "";
      $("searchInput").value = "";
      updateContinue();
      renderAmount();
      hideSheets();
    });
  }

  /* ---------------- 登录校验 ---------------- */
  async function boot() {
    buildKb();
    bindEvents();
    renderAmount();
    updateContinue();

    if (!sid) {
      window.location.href = "/index.html";
      return;
    }
    try {
      const r = await fetch("/api/user", { headers: { "x-session-id": sid } });
      const d = await r.json();
      if (d.ok && d.user) {
        balance = d.user.balance;
      } else if (d.needLogin) {
        localStorage.removeItem("sid");
        window.location.href = "/index.html";
        return;
      }
    } catch (e) {
      // 后端不可用时给一个演示余额
      balance = 1850000;
    }
    renderBalance();
    renderResults();
  }

  window.addEventListener("load", boot);
})();
