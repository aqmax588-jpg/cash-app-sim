/* =========================================================
   Cash App Simulator - script.js
   提速 + 防风控版：
   1. 真实资料本地缓存 12h，命中秒出；兜底绝不写缓存霸占
   2. lookup 接口 1200ms 超时，超时先上兜底，真实回来原地更新
   3. 历史列表本地先渲染，后台并发静默刷新真实资料，不闪不重建
   4. 搜索防抖 150ms，触发更快；兜底昵称随机
   5. 支付网络异常不乱扣余额
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

  /* ============ 本地缓存 ============ */
  // 历史 ID 列表（只存顺序，不存头像昵称）
  function getHistoryCache() {
    try {
      var str = localStorage.getItem('cash_history_' + uid);
      return str ? JSON.parse(str) : [];
    } catch (e) { return []; }
  }
  function setHistoryCache(arr) {
    try {
      localStorage.setItem('cash_history_' + uid, JSON.stringify((arr || []).slice(0, 8)));
} catch (e) {}
  }

  // 真实资料缓存：只存 lookup 成功返回的真实用户，12 小时有效期；兜底不进这里
  function getUserProfileCache(tag) {
    try {
      var raw = localStorage.getItem('cash_profile_v2_' + tag);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.time > 12 * 3600 * 1000) return null;
      return obj.data;
    } catch (e) { return null; }
  }
  function setRealUserProfileCache(tag, data) {
    try {
      localStorage.setItem('cash_profile_v2_' + tag, JSON.stringify({ data: data, time: Date.now() }));
    } catch (e) {}
  }

  // 兜底昵称名字库，随机抽取，兜底出来名字不重复
  var demoNamePool = [
    'Alex Turner', 'Ben Carter', 'Chris Moore', 'Dylan Hill',
    'Ethan Scott', 'Felix Ward', 'Gavin Cole', 'Henry Ford',
    'Iris Bryant', 'Jesse Fisher', 'Kai Hudson', 'Liam Norton',
    'Miles Gibson', 'Noah Powell', 'Owen Harper', 'Peyton Brooks',
    'Quinn Ellis', 'Riley Brooks', 'Sam Cooper', 'Tyler Reed'
  ];

  /* ---------------- 运行状态 ---------------- */
  var balance = 0;
  var myNickname = uid;
var amountStr = '0';
  var targetUser = null;
  var noteStr = '';
  var searchStr = '';
  var kbOpen = false;
  var kbTarget = null;
  var searchSeq = 0;
  var searchTimer = null;
  var payBusy = false;
  var kickTimer = null;

  var KBH = 248;
  var LOOKUP_TIMEOUT = 9000; // 仅防请求永久悬挂；1.2 秒只是先上兜底的视觉节点，不中断请求
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

  /* 带超时的 lookup 请求
     注意：这里超时只用于防止请求永久悬挂（9 秒），不做 1.2 秒中断。
     1.2 秒只是"先上兜底占位"的视觉时间点，真实结果回来后原地替换。 */
  function fetchLookup(tag) {
    return new Promise(function (resolve, reject) {
      var ctrl = ('AbortController' in window) ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('timeout'));
      }, 9000);

      fetch(API + '/user/lookup/' + encodeURIComponent(tag), ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { return r.json(); })
        .then(function (data) { clearTimeout(timer); resolve(data); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
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
    $('searchSheet').classList.toggle('compact', kind === 'search');
    if (kind === 'search') startSearchWatch();   // 点搜索框/键盘时启动输入监控
  }

  function closeKb() {
    syncSearchInput();               // 收键盘前再核对一次输入框内容
    stopSearchWatch();
    kbOpen = false;
    kbTarget = null;
    setKbHeight(0);
    $('softKb').classList.remove('open');
    $('searchSheet').classList.remove('compact');
  }

  /* ---------------- 搜索框实时监控 ----------------
     不依赖键盘按键事件：只要输入框里的内容变了，
     立刻同步到 searchStr 并发起真实数据请求。
     覆盖：自绘键盘、系统键盘残留、粘贴、外部改值等所有情况。 */
  var searchWatchTimer = null;

  function syncSearchInput() {
    var el = $('searchInput');
    if (!el) return;
var v = String(el.value || '');
    if (v.length > 22) { v = v.slice(0, 22); el.value = v; }
    if (v === searchStr) return;          // 没变，什么都不做

    searchStr = v;
    $('searchBox').classList.toggle('has-value', searchStr.length > 0);
    scheduleSearch();                     // 值一变，150ms 防抖后立刻请求真实数据
  }

  function startSearchWatch() {
    stopSearchWatch();
    syncSearchInput();                    // 启动瞬间先检查一次
    searchWatchTimer = setInterval(syncSearchInput, 200);  // 每 200ms 实时检测
  }

  function stopSearchWatch() {
    if (searchWatchTimer) {
      clearInterval(searchWatchTimer);
      searchWatchTimer = null;
    }
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

  /* ---------------- 搜索结果行 ---------------- */
  function makeRow(user, cashtag) {
    var row = document.createElement('div');
    row.className = 'result-row';
    row.dataset.tag = cashtag || user.uid;

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

  // 按 cashtag 找页面上的行（遍历比对，避免特殊字符破坏选择器）
  function findRowByTag(tag) {
    var nodes = $('resultsList').querySelectorAll('.result-row');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].dataset.tag === tag) return nodes[i];
    }
    return null;
  }

  // 原地更新一行（不清空重建，避免列表闪烁）
  function updateRowDom(rowEl, user) {
    var oldAvatar = rowEl.querySelector('.avatar');
    if (oldAvatar) oldAvatar.parentNode.replaceChild(buildAvatar(user), oldAvatar);
    var nameEl = rowEl.querySelector('.result-name');
    if (nameEl) nameEl.textContent = user.nickname || user.uid;
    var tagEl = rowEl.querySelector('.result-tag');
    if (tagEl) tagEl.textContent = '$' + String(user.uid || '').replace(/^\$/g, '');
    rowEl.onclick = null;
    rowEl.addEventListener('click', function () { pickUser(user); });
}

  /* 兜底用户：随机昵称，仅临时渲染，绝不写入本地缓存 */
  function makeDemoUser(raw) {
    var name = String(raw || '').replace(/^\$/g, '').replace(/\s+/g, '');
    if (!name) name = 'user';
    var randNick = demoNamePool[Math.floor(Math.random() * demoNamePool.length)];
    return {
      uid: name,
      nickname: randNick,
      avatar: '',
      avatarFallback: ''
    };
  }

  function renderEmptyState(text) {
    var d = document.createElement('div');
    d.className = 'no-hint';
    d.textContent = text;
    $('resultsList').appendChild(d);
  }

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 300); // 停顿 300ms 再请求，避免每打一个字都打一次上游
  }

  function clearResults() {
    $('resultsList').innerHTML = '';
  }

  /* 把后端返回的 raw user 规整成前端对象
     关键：只有后端 source 不是 fallback（真拿到真实资料）才写缓存，
     否则假数据会霸占 12 小时缓存，之后永远不再请求真实资料。 */
  function normalizeReal(tag, u, source) {
    var real = {
      uid: u.uid || tag,
      nickname: u.nickname || tag,
avatar: u.avatar || '',
      avatarFallback: u.avatarFallback || ''
    };
    if (source !== 'fallback') setRealUserProfileCache(tag, real);
    return real;
  }

  /* ---------------- 历史联系人 ---------------- */
  // 打开历史：本地缓存立刻渲染；后台并发静默拉真实资料，原地更新对应行
  function loadHistoryList() {
    clearResults();
    var localIds = getHistoryCache();

    if (!localIds.length) {
      renderEmptyState('No recent contacts. Type a $Cashtag to search.');
    } else {
      localIds.forEach(function (tag) {
        var cached = getUserProfileCache(tag);
        var showUser = cached ? cached : makeDemoUser(tag);
        $('resultsList').appendChild(makeRow(showUser, tag));
      });
    }

    // 后台：先拿后端最新 ID 顺序，再并发补 lookup 真实资料
    (async function backgroundRefresh() {
      var ids = localIds.slice();
      try {
        var resHis = await fetch(API + '/user/search-history/' + encodeURIComponent(uid));
        var his = await resHis.json();
        if (his && his.ok && Array.isArray(his.list)) {
ids = his.list.slice(0, 8);
          setHistoryCache(ids);
          // 后端顺序变了，按最新顺序重绘一次（仍走本地缓存/兜底，不阻塞）
          clearResults();
          ids.forEach(function (tag) {
            var cached = getUserProfileCache(tag);
            var showUser = cached ? cached : makeDemoUser(tag);
            $('resultsList').appendChild(makeRow(showUser, tag));
          });
        }
      } catch (e) { /* 后端历史接口失败，沿用本地 ID 顺序 */ }

      // 并发请求所有缺失真实资料的 ID，拿到后原地更新对应行
      var tasks = ids.map(function (tag) {
        if (getUserProfileCache(tag)) return Promise.resolve();
        return fetchLookup(tag)
          .then(function (d) {
            if (d && d.ok && d.user && d.source !== 'fallback') {
              var real = normalizeReal(tag, d.user, d.source);
              var row = findRowByTag(tag);
              if (row) updateRowDom(row, real);
            }
          })
          .catch(function () { /* 超时/失败保留兜底 */ });
      });
      await Promise.all(tasks);
    })();
  }

  /* ---------------- 搜索 ---------------- */
function renderResults() {
    var q = searchStr.trim().replace(/^\$/g, '');
    var seq = ++searchSeq;
    clearResults();

    // 空输入：展示历史
    if (!q) {
      loadHistoryList();
      return;
    }

    $('resultsHead').textContent = 'RESULTS';

    // 命中本地真实缓存：直接秒出真实，不发请求
    var cached = getUserProfileCache(q);
    if (cached) {
      $('resultsList').appendChild(makeRow(cached, q));
      return;
    }

    // 无缓存：立刻上兜底占位，同时后台请求真实接口；真实一回来就原地替换这一行
    $('resultsList').appendChild(makeRow(makeDemoUser(q), q));

    // 只有 2 个字符以上才真发请求，避免打一个字就打一次上游（防风控）
    if (q.length < 2) return;

    requestRealLookup(q, seq, 0);
  }

  /* 请求真实资料：没拿到真实结果时，2.5 秒后自动补一次（第二次通常命后端缓存，秒回真实） */
  function requestRealLookup(tag, seq, attempt) {
    fetchLookup(tag)
      .then(function (d) {
        if (seq !== searchSeq) return; // 用户已改成别的输入，丢弃旧结果
        // 真拿到真实资料（source 不是 fallback），原地替换这一行
        if (d && d.ok && d.user && d.source !== 'fallback') {
          var real = normalizeReal(tag, d.user, d.source);
var row = findRowByTag(tag);
          if (row) updateRowDom(row, real);
          else { clearResults(); $('resultsList').appendChild(makeRow(real, tag)); }
          return;
        }
        // 后端只给了兜底：保留页面兜底，补一次重试
        if (attempt === 0) {
          setTimeout(function () {
            if (seq !== searchSeq) return;
            requestRealLookup(tag, seq, 1);
          }, 2500);
        }
      })
      .catch(function () {
        // 超时 / 网络失败：保留兜底，并在 2.5 秒后补一次请求
        if (seq !== searchSeq) return;
        if (attempt === 0) {
          setTimeout(function () {
            if (seq !== searchSeq) return;
            requestRealLookup(tag, seq, 1);
          }, 2500);
        }
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
  }

  function saveHistory(id) {
    var clean = String(id || '').replace(/^\$/g, '').trim();
    if (!clean) return;
    fetch(API + '/user/save-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, searchId: clean })
    })
      .then(function (r) { return r.json(); })
      .catch(function () {});

    // 同步本地历史缓存：置顶去重
    var cache = getHistoryCache();
    cache = cache.filter(function (x) { return x !== clean; });
    cache.unshift(clean);
    setHistoryCache(cache);
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

  /* ---------------- 顶部通知 ---------------- */
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
          if (d && /kicked|Session/i.test(d.msg || '')) { showKickMask(); }
else {
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
      })
      .catch(function () {});

    kickTimer = setInterval(checkKick, 9000);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 阻止手机系统键盘：搜索框/备注框只用来显示，输入统一走自绘键盘
    ['searchInput', 'noteInput'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var kind = (id === 'searchInput') ? 'search' : 'note';
      // 移动端：直接拦掉触摸，自己开自绘键盘，系统键盘完全不出现
      el.addEventListener('touchstart', function (e) {
        e.preventDefault();
        openKb(kind);
      }, { passive: false });
      // PC 端：阻止聚焦，避免光标和输入法
      el.addEventListener('mousedown', function (e) { e.preventDefault(); });
      // 兜底：万一被聚焦，立刻失焦
      el.addEventListener('focus', function () { el.blur(); });
});

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
      showSheet('searchSheet');
      loadHistoryList();
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
loadHistoryList();
    });

    // 点备注框 -> 弹键盘
    $('noteInput').addEventListener('click', function () { openKb('note'); });

    // 弹窗空白处 -> 收键盘
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
      loadHistoryList();
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
            // 网络异常：不乱扣余额，提示失败
            payBusy = false;
            hideSheets();
            alert('Network error, payment failed, balance unchanged.');
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

    // Done -> 回到最初界面
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
    });
  }

  window.addEventListener('load', function () {
    bind();
    boot();
  });
})();
