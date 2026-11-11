/* =========================================================
   Cash App Simulator - script.js (全量版)
   对接 server.js: /api/user/info /lookup /pay /search-history /check-kick
   最小改动：pickUser增加saveHistory调用，saveHistory增加调试日志，其余全部原版
   ========================================================= */
(function () {
  'use strict';
  var API = '/api';
  var $ = function (id) { return document.getElementById(id); };
  var uid = localStorage.getItem('uid') || '';
  var clientId = localStorage.getItem('clientId') || '';
  if (!uid || !clientId) {
    location.replace('/');
    return;
  }
  /* ---------------- 运行状态 ---------------- */
  var balance = 0;
  var myNickname = uid;
  var amountStr = '0';
  var targetUser = null;
  var noteStr = '';
  var searchStr = '';
  var kbOpen = false;
  var kbTarget = null;
  var historyList = [];
  var searchSeq = 0;
  var searchTimer = null;
  var payBusy = false;
  var kickTimer = null;
  var KBH = 248;
  var SHEETS = ['searchSheet', 'noteSheet', 'confirmSheet', 'loadingSheet'];
  /* ---------------- 工具 ---------------- */
  function money(v) {
    var p = String(v == null ? '0' : v).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }
  function money2(n) {
    var num = Number(n);
    if (isNaN(num)) num = 0;
    return money(num.toFixed(2));
  }
  function colorOf(key) {
    var s = String(key || 'x');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',48%,58%)';
  }
  function initial(name) {
    var t = String(name || '?').replace(/^\$/g, '').trim();
    return (t.charAt(0) || '?').toUpperCase();
  }
  /* ---------------- 渲染基础信息 ---------------- */
  function renderAmount() {
    $('amountText').textContent = '$' + money(amountStr);
    $('searchTitle').textContent = 'Pay $' + money(amountStr);
    $('searchPayTo').textContent = 'Pay ' + money(amountStr) + ' to';
    $('notePayTo').textContent = 'Pay ' + money(amountStr) + ' to';
    $('confirmPayTo').textContent = 'Pay ' + money(amountStr) + ' to';
  }
  function renderBalance() {
    $('balanceText').textContent = '$' + money2(balance);
    $('tabBalance').textContent = '$' + money2(balance);
  }
  function renderMe() {
    var av = $('topAvatar');
    av.textContent = initial(myNickname);
    av.style.background = colorOf(uid);
  }
  /* ---------------- 头像组件 ---------------- */
  function buildAvatar(user, small) {
    var br = document.createElement('div');
    br.className = 'avatar' + (small ? ' avatar-sm' : '');
    br.style.background = colorOf(user.uid || user.nickname);
    br.textContent = initial(user.nickname || user.uid);
    if (user.avatar) {
      var img = document.createElement('img');
      img.className = 'avatar-img';
      img.src = user.avatar;
      img.alt = '';
      // 中转图片失败时，自动退回原始地址；再失败就隐藏，露出下面的首字母底色
      img.onerror = function () {
        if (user.avatarFallback && img.src !== user.avatarFallback) {
          img.src = user.avatarFallback;
          return;
        }
        if (img.parentNode) img.parentNode.removeChild(img);
      };
      br.appendChild(img);
    }
    return br;
  }
  function setAvatarBox(el, user) {
    el.style.background = colorOf(user.uid || user.nickname);
    el.textContent = initial(user.nickname || user.uid);
    var old = el.querySelector('img');
    if (old) el.removeChild(old);
    if (user.avatar) {
      var img = document.createElement('img');
      img.className = 'avatar-img';
      img.src = user.avatar;
      img.onerror = function () {
        if (user.avatarFallback && img.src !== user.avatarFallback) {
          img.src = user.avatarFallback;
          return;
        }
        if (img.parentNode) img.parentNode.removeChild(img);
      };
      el.appendChild(img);
    }
  }
  /* ---------------- 弹窗控制 ---------------- */
  function showSheet(name) {
    $('sheetLayer').classList.add('open');
    SHEETS.forEach(function (id) {
      $(id).classList.toggle('open', id === name);
    });
  }
  function hideSheets() {
    closeKb();
    $('sheetLayer').classList.remove('open');
    SHEETS.forEach(function (id) { $(id).classList.remove('open'); });
  }
  /* ---------------- 自定义键盘 ---------------- */
  function setKbHeight(h) {
    document.documentElement.style.setProperty('--kb-h', h + 'px');
  }
  function buildKb() {
    var kb = $('softKb');
    var rows = [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
      ['del', 'space', 'ok']
    ];
    kb.innerHTML = '';
    rows.forEach(function (row) {
      var r = document.createElement('div');
      r.className = 'kb-row';
      row.forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'kb-key';
        if (k === 'ok') b.className += ' kb-ok';
        if (k === 'del') b.className += ' kb-del';
        if (k === 'space') b.className += ' kb-space';
        b.textContent = k === 'del' ? '⌫' : (k === 'ok' ? '✓' : (k === 'space' ? 'space' : k));
        b.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          onKbKey(k);
        });
        r.appendChild(b);
      });
      kb.appendChild(r);
    });
  }
  function openKb(kind) {
    kbTarget = kind;
    kbOpen = true;
    setKbHeight(KBH);
    $('softKb').classList.add('open');
    // 搜索页弹键盘时切紧凑模式，保证结果行不被键盘挡住
    $('searchSheet').classList.toggle('compact', kind === 'search');
  }
  function closeKb() {
    kbOpen = false;
    kbTarget = null;
    setKbHeight(0);
    $('softKb').classList.remove('open');
    $('searchSheet').classList.remove('compact');
  }
  function onKbKey(k) {
    if (k === 'ok') { closeKb(); return; }
    if (kbTarget === 'search') {
      if (k === 'del') searchStr = searchStr.slice(0, -1);
      else searchStr += (k === 'space' ? ' ' : k);
      if (searchStr.length > 22) searchStr = searchStr.slice(0, 22);
      $('searchInput').value = searchStr;
      $('searchBox').classList.toggle('has-value', searchStr.length > 0);
      scheduleSearch();
      return;
    }
    if (kbTarget === 'note') {
      if (k === 'del') noteStr = noteStr.slice(0, -1);
      else {
        if (noteStr.length >= 24) return;
        noteStr += (k === 'space' ? ' ' : k);
      }
      $('noteInput').value = noteStr;
      updateContinue();
    }
  }
  function updateContinue() {
    var b = $('continueBtn');
    var on = noteStr.trim().length > 0;
    b.disabled = !on;
    b.classList.toggle('active', on);
  }
  /* ---------------- 搜索 ---------------- */
  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 260);
  }
  function clearResults() {
    $('resultsList').innerHTML = '';
  }
  function makeRow(user) {
    var row = document.createElement('div');
    row.className = 'result-row';
    row.appendChild(buildAvatar(user));
    var info = document.createElement('div');
    info.className = 'result-info';
    var n = document.createElement('div');
    n.className = 'result-name';
    n.textContent = user.nickname || user.uid;
    var t = document.createElement('div');
    t.className = 'result-tag';
    t.textContent = '$' + String(user.uid || '').replace(/^\$/g, '');
    info.appendChild(n);
    info.appendChild(t);
    row.appendChild(info);
    row.addEventListener('click', function () { pickUser(user); });
    return row;
  }
  /* 兜底用户：外观与真实用户完全一致，不带任何标记 */
  function makeDemoUser(raw) {
    var name = String(raw || '').replace(/^\$/g, '').replace(/\s+/g, '');
    if (!name) name = 'user';
    return {
      uid: name,
      nickname: name.charAt(0).toUpperCase() + name.slice(1),
      avatar: ''
    };
  }
  function renderEmptyState(text) {
    var d = document.createElement('div');
    d.className = 'no-hint';
    d.textContent = text;
    $('resultsList').appendChild(d);
  }
  function renderResults() {
    var q = searchStr.trim().replace(/^\$/g, '');
    var seq = ++searchSeq;
    clearResults();
    // 没输入：展示搜索历史
    if (!q) {
      $('resultsHead').textContent = 'RESULTS';
      if (!historyList.length) {
        renderEmptyState('No recent contacts. Type a $Cashtag to search.');
        return;
      }
      historyList.forEach(function (u) {
        $('resultsList').appendChild(makeRow(u));
      });
      return;
    }
    $('resultsHead').textContent = 'RESULTS';
    // 接口稍慢时先给一条联系人占位，避免看起来"没反应"
    var pendingTimer = setTimeout(function () {
      if (seq !== searchSeq) return;
      if ($('resultsList').children.length) return;
      $('resultsList').appendChild(makeRow(makeDemoUser(q)));
    }, 120);
    fetch(API + '/user/lookup/' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        clearTimeout(pendingTimer);
        if (seq !== searchSeq) return;
        clearResults();
        if (data && data.ok && data.user) {
          var real = {
            uid: data.user.uid,
            nickname: data.user.nickname,
            avatar: data.user.avatar || '',
            avatarFallback: data.user.avatarFallback || ''
          };
          $('resultsList').appendChild(makeRow(real));
          return;
        }
        // 兜底：直接显示一条联系人，外观与真实结果一致，保证流程能继续
        $('resultsList').appendChild(makeRow(makeDemoUser(q)));
      })
      .catch(function () {
        clearTimeout(pendingTimer);
        if (seq !== searchSeq) return;
        clearResults();
        $('resultsList').appendChild(makeRow(makeDemoUser(q)));
      });
  }
  function pickUser(user) {
    targetUser = user;
    noteStr = '';
    $('noteInput').value = '';
    $('noteName').textContent = user.nickname || user.uid;
    $('confirmName').textContent = user.nickname || user.uid;
    setAvatarBox($('noteAvatar'), user);
    setAvatarBox($('confirmAvatar'), user);
    updateContinue();
    closeKb();
    showSheet('noteSheet');
    saveHistory(user.uid);
  }
  /* ---------------- 历史联系人 ---------------- */
  function loadHistory() {
    fetch(API + '/user/search-history/' + encodeURIComponent(uid))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.list)) return;
        var ids = data.list.slice(0, 8);
        var out = [];
        var i = 0;
        function step() {
          if (i >= ids.length) {
            historyList = out;
            return;
          }
          var id = ids[i++];
          fetch(API + '/user/lookup/' + encodeURIComponent(id))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d && d.ok && d.user) {
                out.push({ uid: d.user.uid, nickname: d.user.nickname, avatar: d.user.avatar || '', avatarFallback: d.user.avatarFallback || '' });
              } else {
                out.push(makeDemoUser(id));
              }
            })
            .catch(function () { out.push(makeDemoUser(id)); })
            .then(step);
        }
        step();
      })
      .catch(function () {});
  }
  function saveHistory(id) {
    var clean = String(id || '').replace(/^\$/g, '').trim();
    if (!clean) return;
    fetch(API + '/user/save-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, searchId: clean })
    })
    .then(res=>res.json())
    .then(ret=>{console.log("保存搜索历史结果：",ret);})
    .catch(err=>{console.error("保存搜索历史失败",err);});
  }
  /* ---------------- 首页数字键盘 ---------------- */
  function pressNum(k) {
    if (k === 'del') {
      amountStr = amountStr.length > 1 ? amountStr.slice(0, -1) : '0';
    } else if (k === '.') {
      if (amountStr.indexOf('.') === -1) amountStr += '.';
    } else {
      if (amountStr.indexOf('.') !== -1) {
        var dec = amountStr.split('.')[1] || '';
        if (dec.length >= 2) return;
      }
      if (amountStr === '0') amountStr = k;
      else {
        var digits = amountStr.replace('.', '');
        if (digits.length >= 10) return;
        amountStr += k;
      }
    }
    renderAmount();
  }
  /* ---------------- 顶部通知（独立计时） ---------------- */
  function showToast(amt, name) {
    $('toastBody').textContent = 'You paid ' + name + ' $' + money2(amt);
    $('toast').classList.add('show');
    setTimeout(function () {
      $('toast').classList.remove('show');
    }, 2000);
  }
  /* ---------------- 成功页 ---------------- */
  function showSuccess(amt) {
    $('successText').textContent = 'You sent $' + money2(amt) + ' to ' + (targetUser ? (targetUser.nickname || targetUser.uid) : '');
    $('successScreen').classList.add('open');
    $('homeScreen').style.display = 'none';
    setTimeout(function () {
      showToast(amt, targetUser ? (targetUser.nickname || targetUser.uid) : '');
    }, 20);
  }
  /* ---------------- 提示框 ---------------- */
  function showAlert() { $('alertMask').classList.add('open'); }
  function showKickMask() { $('kickMask').classList.add('open'); }
  /* ---------------- 登录态校验 ---------------- */
  function checkKick() {
    fetch(API + '/user/check-kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, clientId: clientId })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.kicked) {
          if (kickTimer) clearInterval(kickTimer);
          showKickMask();
        }
      })
      .catch(function () {});
  }
  function boot() {
    buildKb();
    renderAmount();
    renderBalance();
    renderMe();
    updateContinue();
    fetch(API + '/user/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, clientId: clientId })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) {
          if (d && /kicked|Session/.test(d.msg || '')) {
            showKickMask();
          } else {
            localStorage.removeItem('uid');
            localStorage.removeItem('clientId');
            location.replace('/');
          }
          return;
        }
        balance = Number(d.user.balance) || 0;
        myNickname = d.user.nickname || d.user.uid;
        renderBalance();
        renderMe();
        loadHistory();
      })
      .catch(function () {});
    kickTimer = setInterval(checkKick, 9000);
  }
  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 数字键盘
    $('numkeypad').addEventListener('click', function (e) {
      var btn = e.target.closest('.numkey');
      if (!btn) return;
      pressNum(btn.getAttribute('data-key'));
    });
    // 首页 Pay -> 搜索弹窗
    $('payEntry').addEventListener('click', function () {
      var v = parseFloat(amountStr);
      if (!v || v <= 0) {
        amountStr = '0';
        renderAmount();
        return;
      }
      searchStr = '';
      searchSeq++;
      $('searchInput').value = '';
      $('searchBox').classList.remove('has-value');
      renderResults();
      if (historyList.length) renderResults();
      showSheet('searchSheet');
    });
    // 关闭搜索
    $('closeSearch').addEventListener('click', function () { hideSheets(); });
    // 点搜索框 -> 弹键盘
    $('searchInput').addEventListener('click', function () { openKb('search'); });
    // 清除
    $('searchClear').addEventListener('click', function (e) {
      e.stopPropagation();
      searchStr = '';
      $('searchInput').value = '';
      $('searchBox').classList.remove('has-value');
      renderResults();
    });
    // 点备注框 -> 弹键盘
    $('noteInput').addEventListener('click', function () { openKb('note'); });
    // 弹窗空白处 -> 收键盘（点输入框不收）
    $('sheetLayer').addEventListener('pointerdown', function (e) {
      if (!kbOpen) return;
      if (e.target.closest('.soft-kb')) return;
      if (e.target.id === 'searchInput' || e.target.id === 'noteInput') return;
      closeKb();
    });
    // 备注页返回
    $('noteBack').addEventListener('click', function () {
      closeKb();
      showSheet('searchSheet');
    });
    // Continue
    $('continueBtn').addEventListener('click', function () {
      if (!noteStr.trim()) return;
      closeKb();
      saveHistory(targetUser.uid);
      $('confirmNote').textContent = noteStr;
      renderBalance();
      showSheet('confirmSheet');
    });
    // Style it（占位装饰）
    $('styleBtn').addEventListener('click', function () {
      if (noteStr.indexOf('✨') !== -1) return;
      noteStr = noteStr + ' ✨';
      $('confirmNote').textContent = noteStr;
    });
    // 支付
    $('confirmPay').addEventListener('click', function () {
      if (payBusy) return;
      var amt = parseFloat(amountStr);
      if (!amt || amt <= 0) { hideSheets(); return; }
      if (Number(balance) < amt) {
        showAlert();
        return;
      }
      payBusy = true;
      showSheet('loadingSheet');
      var wait = 2000 + Math.random() * 1000;
      setTimeout(function () {
        fetch(API + '/user/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: uid,
            clientId: clientId,
            amount: amt,
            remark: noteStr,
            targetUid: targetUser ? targetUser.uid : ''
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            payBusy = false;
            if (!d || !d.ok) {
              hideSheets();
              if (d && /Insufficient/i.test(d.msg || '')) {
                if (d.balance != null) balance = Number(d.balance);
                renderBalance();
                showAlert();
              } else if (d && /kicked|Session/i.test(d.msg || '')) {
                showKickMask();
              }
              return;
            }
            balance = Number(d.balance) || 0;
            renderBalance();
            hideSheets();
            showSuccess(amt);
          })
          .catch(function () {
            // 后端不可达时本地扣减，保证演示不中断
            payBusy = false;
            balance = Math.max(0, Number(balance) - amt);
            renderBalance();
            hideSheets();
            showSuccess(amt);
          });
      }, wait);
    });
    // 余额不足关闭
    $('alertOk').addEventListener('click', function () {
      $('alertMask').classList.remove('open');
      showSheet('confirmSheet');
    });
    // 被踢下线
    $('kickOk').addEventListener('click', function () {
      localStorage.removeItem('uid');
      localStorage.removeItem('clientId');
      location.replace('/');
    });
    // Receipt
    $('receiptBtn').addEventListener('click', function () {
      var name = targetUser ? (targetUser.nickname || targetUser.uid) : '';
      alert('Receipt\n\nTo: ' + name + ' ($' + (targetUser ? targetUser.uid : '') + ')\n' +
        'Amount: $' + money2(parseFloat(amountStr)) + '\n' +
        'Note: ' + noteStr + '\n' +
        'Status: Completed');
    });
    // Done -> 回到最初界面（不清除 toast 计时）
    $('doneBtn').addEventListener('click', function () {
      $('successScreen').classList.remove('open');
      $('homeScreen').style.display = 'flex';
      amountStr = '0';
      targetUser = null;
      noteStr = '';
      searchStr = '';
      $('noteInput').value = '';
      $('searchInput').value = '';
      $('searchBox').classList.remove('has-value');
      updateContinue();
      renderAmount();
      renderBalance();
      hideSheets();
      loadHistory();
    });
  }
  window.addEventListener('load', function () {
    bind();
    boot();
  });
})();
