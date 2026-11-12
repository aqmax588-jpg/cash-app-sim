/* =========================================================
Cash App Simulator｜修复搜索卡死、输入不查真实接口
核心规则：输入内容=只搜真实接口；空输入=加载历史；真实优先
========================================================= */
(function () {
  'use strict';
  var API = '/api';
  var $ = function (id) { return document.getElementById(id); };
  var uid = localStorage.getItem('uid') || '';
  var clientId = localStorage.getItem('clientId') || '';

  // 历史ID数组缓存（只存ID顺序，不存头像昵称）
  function getHistoryCache(){
    const str = localStorage.getItem('cash_history_'+uid);
    if(str) return JSON.parse(str);
    return [];
  }
  function setHistoryCache(arr){
    localStorage.setItem('cash_history_'+uid, JSON.stringify(arr.slice(0,8)));
  }

  // 只保存真实接口返回的用户资料，12小时有效期（v3：兜底数据绝不进缓存）
  function getUserProfileCache(cashtag){
    const key = 'cash_profile_v3_' + String(cashtag||'').replace(/^\$/g,'').toLowerCase();
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    let obj = null;
    try{ obj = JSON.parse(raw); }catch(e){ return null; }
    if(!obj || !obj.data) return null;
    if(obj.data.source === 'fallback') return null;
    if(Date.now() - obj.time > 12 * 3600 * 1000) return null;
    return obj.data;
  }
  function setRealUserProfileCache(cashtag, data, source){
    // 只有真实数据才写缓存：兜底一律不写，避免假数据霸占12小时
    if(!data || !data.uid) return;
    const src = source || data.source || '';
    if(src === 'fallback') return;
    const key = 'cash_profile_v3_' + String(cashtag||'').replace(/^\$/g,'').toLowerCase();
    localStorage.setItem(key, JSON.stringify({
      data: {
        uid: data.uid,
        nickname: data.nickname || data.uid,
        avatar: data.avatar || '',
        avatarFallback: data.avatarFallback || '',
        source: src
      },
      time: Date.now()
    }));
  }

  // 兜底昵称池：同一个 ID 稳定，不同 ID 有变化，看起来不像复制粘贴
  var DEMO_NAMES = ['Alex','Jordan','Taylor','Casey','Riley','Morgan','Jamie','Avery','Parker','Quinn','Skyler','Rowan','Emerson','Blake','Dakota','Reese','Sawyer','Elliot','Charlie','Hayden','Kendall','Marlow'];
  function demoNick(raw){
    var name = String(raw || '').replace(/^\$/g, '').replace(/\s+/g, '');
    if (!name) name = 'user';
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
    var pick = DEMO_NAMES[h % DEMO_NAMES.length];
    return pick + ' ' + name.charAt(0).toUpperCase() + name.slice(1);
  }

  // 兜底对象：仅临时渲染，不写入缓存
  function makeDemoUser(raw) {
    var name = String(raw || '').replace(/^\$/g, '').replace(/\s+/g, '');
    if (!name) name = 'user';
    return {
      uid: name,
      nickname: demoNick(name),
      avatar: '',
      avatarFallback: ''
    };
  }

  if (!uid || !clientId) {
    location.replace('/');
    return;
  }

  var balance = 0;
  var myNickname = uid;
  var myAvatar = '';
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
  var SHEETS = ['searchSheet', 'noteSheet', 'confirmSheet', 'loadingSheet'];

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
    if (myAvatar) {
      av.textContent = '';
      av.style.backgroundImage = 'url("' + myAvatar + '")';
    } else {
      av.textContent = initial(myNickname);
      av.style.backgroundImage = '';
    }
  }
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
        if (img.parentNode) img.parentNode.removeChild(img);
      };
      el.appendChild(img);
    }
  }
  function makeRow(user) {
    var row = document.createElement('div');
    row.className = 'result-row';
    row.__user = user;
    row.dataset.tag = String(user.uid || '').replace(/^\$/g, '');
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
    row.addEventListener('click', function () { pickUser(row.__user || user); });
    return row;
  }
  // 真实数据回来后，原地刷新这一行（不重建列表、不闪烁）
  function updateRowDom(row, user) {
    if (!row || !user) return;
    var tag = String(user.uid || '').replace(/^\$/g, '');
    if (tag && !/\s/.test(tag)) {
      row.dataset.tag = tag;
    }
    row.__user = user;
    var av = row.querySelector('.avatar');
    if (av) setAvatarBox(av, user);
    var n = row.querySelector('.result-name');
    if (n) n.textContent = user.nickname || user.uid;
    var t = row.querySelector('.result-tag');
    if (t) t.textContent = '$' + tag;
  }
  function findRowByTag(tag) {
    var key = String(tag || '').replace(/^\$/g, '').trim().toLowerCase();
    if (!key) return null;
    var rows = $('resultsList').querySelectorAll('.result-row');
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].dataset.tag || '').toLowerCase() === key) return rows[i];
    }
    return null;
  }
  function renderEmptyState(text) {
    var d = document.createElement('div');
    d.className = 'no-hint';
    d.textContent = text;
    $('resultsList').appendChild(d);
  }
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
    if (kind === 'search') startSearchWatch();
  }
  function closeKb() {
    syncSearchInput();
    stopSearchWatch();
    kbOpen = false;
    kbTarget = null;
    setKbHeight(0);
    $('softKb').classList.remove('open');
    $('searchSheet').classList.remove('compact');
  }

  // ===== 输入框实时监控：光标一点/键盘一开就监控，值一变立刻请求真实数据 =====
  var searchWatchTimer = null;
  function syncSearchInput() {
    var el = $('searchInput');
    if (!el) return;
    var v = String(el.value || '');
    if (v === searchStr) return;
    searchStr = v.length > 22 ? v.slice(0, 22) : v;
    if (v.length > 22) el.value = searchStr;
    $('searchBox').classList.toggle('has-value', searchStr.length > 0);
    scheduleSearch();
  }
  function startSearchWatch() {
    if (searchWatchTimer) return;
    searchWatchTimer = setInterval(syncSearchInput, 200);
  }
  function stopSearchWatch() {
    if (!searchWatchTimer) return;
    clearInterval(searchWatchTimer);
    searchWatchTimer = null;
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
  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 300);
  }
  function clearResults() {
    $('resultsList').innerHTML = '';
  }

  // 统一的真实资料请求：9 秒才放弃（只防悬挂，绝不提前掐断真实结果）
  function fetchLookupRaw(tag) {
    var clean = String(tag || '').replace(/^\$/g, '').trim();
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    }, 9000);
    var url = API + '/user/lookup/' + encodeURIComponent(clean);
    var opt = ctrl ? { signal: ctrl.signal } : {};
    return fetch(url, opt)
      .then(function (r) { return r.json(); })
      .then(function (d) { clearTimeout(timer); return d; })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  // 历史列表：先用本地 ID 秒渲染，真实资料并发补齐并原地替换
  function loadHistoryList() {
    clearResults();
    var localIdList = getHistoryCache();
    if (localIdList && Array.isArray(localIdList) && localIdList.length > 0) {
      localIdList.forEach(function (id) {
        var cachedUser = getUserProfileCache(id);
        $('resultsList').appendChild(makeRow(cachedUser ? cachedUser : makeDemoUser(id)));
      });
      // 并发补真实（不是一条一条排队，不会拖慢）
      localIdList.forEach(function (id) { refreshHistoryRow(id); });
    } else {
      renderEmptyState('No recent contacts. Type a $Cashtag to search.');
    }
  }
  // 单条历史：没有真实缓存才去请求，拿到真实后原地替换那一行
  function refreshHistoryRow(tag) {
    var clean = String(tag || '').replace(/^\$/g, '').trim();
    if (!clean) return;
    if (getUserProfileCache(clean)) return;
    fetchLookupRaw(clean).then(function (data) {
      if (!data || !data.ok || !data.user || data.source === 'fallback') return;
      setRealUserProfileCache(clean, data.user, data.source);
      var row = findRowByTag(clean);
      if (row) updateRowDom(row, data.user);
    }).catch(function () {});
  }

  // 搜索结果：真实优先，先兜底占位，真实回来原地替换；失败 2.5 秒补一次
  function requestRealLookup(tag, seq, attempt) {
    var clean = String(tag || '').replace(/^\$/g, '').trim();
    if (!clean) return;
    fetchLookupRaw(clean).then(function (data) {
      if (seq !== searchSeq) return;
      if (data && data.ok && data.user && data.source !== 'fallback') {
        setRealUserProfileCache(clean, data.user, data.source);
        var row = findRowByTag(clean);
        if (row) updateRowDom(row, data.user);
        else {
          clearResults();
          $('resultsList').appendChild(makeRow(data.user));
        }
        return;
      }
      if (attempt < 1) {
        setTimeout(function () {
          if (seq === searchSeq) requestRealLookup(clean, seq, attempt + 1);
        }, 2500);
      }
    }).catch(function () {
      if (seq !== searchSeq) return;
      if (attempt < 1) {
        setTimeout(function () {
          if (seq === searchSeq) requestRealLookup(clean, seq, attempt + 1);
        }, 2500);
      }
    });
  }

  // ========== 搜索主函数 ==========
  function renderResults() {
    var q = searchStr.trim().replace(/^\$/g, '');
    var seq = ++searchSeq;
    clearResults();

    // 空输入：加载历史
    if (!q) {
      loadHistoryList();
      return;
    }

    // 有搜索内容：只做真实lookup，不再加载历史！
    $('resultsHead').textContent = 'RESULTS';

    // 本地有真实缓存：真实秒出，并发一个后台请求更新它（以防头像换了）
    var cached = getUserProfileCache(q);
    if (cached) {
      $('resultsList').appendChild(makeRow(cached));
      requestRealLookup(q, seq, 1);
      return;
    }

    // 无缓存：先兜底占位（立刻有反应，界面不空），真实结果回来原地替换
    $('resultsList').appendChild(makeRow(makeDemoUser(q)));

    // 只有 2 个字符以上才真发请求，避免打一个字就打一次上游（防风控）
    if (q.length < 2) return;

    requestRealLookup(q, seq, 0);
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
    // 点到的是兜底行：流程里继续补真实，真实回来就换掉头像昵称（不影响后续支付）
    if (!user.avatar) {
      var tag = String(user.uid || '').replace(/^\$/g, '').trim();
      if (tag) {
        fetchLookupRaw(tag).then(function (data) {
          if (!data || !data.ok || !data.user || data.source === 'fallback') return;
          setRealUserProfileCache(tag, data.user, data.source);
          if (!targetUser) return;
          targetUser = data.user;
          $('noteName').textContent = data.user.nickname || data.user.uid;
          $('confirmName').textContent = data.user.nickname || data.user.uid;
          setAvatarBox($('noteAvatar'), data.user);
          setAvatarBox($('confirmAvatar'), data.user);
        }).catch(function () {});
      }
    }
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
    .then(ret=>{
      let cache = getHistoryCache() || [];
      cache = cache.filter(x=>x!==clean);
      cache.unshift(clean);
      setHistoryCache(cache);
    })
    .catch(err=>{console.error("save‑search err",err);});
  }

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

  function showToast(amt, name) {
    $('toastBody').textContent = 'You paid ' + name + ' $' + money2(amt);
    $('toast').classList.add('show');
    setTimeout(function () { $('toast').classList.remove('show'); }, 2000);
  }
  function showSuccess(amt) {
    $('successText').textContent = 'You sent $' + money2(amt) + ' to ' + (targetUser ? (targetUser.nickname || targetUser.uid) : '');
    $('successScreen').classList.add('open');
    $('homeScreen').style.display = 'none';
    setTimeout(function () { showToast(amt, targetUser ? (targetUser.nickname || targetUser.uid) : ''); }, 20);
  }
  function showAlert() { $('alertMask').classList.add('open'); }
  function showKickMask() { $('kickMask').classList.add('open'); }
  function checkKick() {
    fetch(API + '/user/check-kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid, clientId: clientId })
    })
      .then(r => r.json())
      .then(d => { if(d && d.kicked){ if(kickTimer)clearInterval(kickTimer); showKickMask();} })
      .catch(() => {});
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
      .then(r => r.json())
      .then(function (d) {
        if (!d || !d.ok) {
          if (d && /kicked|Session/.test(d.msg || '')) { showKickMask(); }
          else { localStorage.removeItem('uid'); localStorage.removeItem('clientId'); location.replace('/'); }
          return;
        }
        balance = Number(d.user.balance) || 0;
        myNickname = d.user.nickname || d.user.uid;
        myAvatar = d.user.avatar || '';
        renderBalance();
        renderMe();
      })
      .catch(function () {});
    kickTimer = setInterval(checkKick, 9000);
  }
  // 输入框点击拦截：屏蔽手机自带键盘，只开自绘键盘；同时启动输入实时监控
  function guardInput(el, kind) {
    if (!el) return;
    el.addEventListener('touchstart', function (e) {
      e.preventDefault();
      openKb(kind);
    }, { passive: false });
    el.addEventListener('mousedown', function (e) {
      e.preventDefault();
      openKb(kind);
    });
    el.addEventListener('click', function () { openKb(kind); });
    el.addEventListener('focus', function () { el.blur(); });
    el.addEventListener('input', function () {
      if (kind === 'search') syncSearchInput();
    });
  }
  function bind() {
    guardInput($('searchInput'), 'search');
    guardInput($('noteInput'), 'note');
    $('numkeypad').addEventListener('click', function (e) {
      var btn = e.target.closest('.numkey');
      if (!btn) return;
      var key = btn.dataset.key;
      pressNum(key);
    });
    $('payEntry').addEventListener('click', function () {
      var v = parseFloat(amountStr);
      if (!v || v <= 0) {
        amountStr = '0';
        renderAmount();
        return;
      }
      searchStr = '';
      $('searchInput').value = '';
      $('searchBox').classList.remove('has-value');
      showSheet('searchSheet');
      loadHistoryList();
    });
    $('closeSearch').addEventListener('click', function () { hideSheets(); });
    $('searchClear').addEventListener('click', function (e) {
      e.stopPropagation();
      searchStr = '';
      $('searchInput').value = '';
      $('searchBox').classList.remove('has-value');
      loadHistoryList();
    });
    $('sheetLayer').addEventListener('pointerdown', function (e) {
      if (!kbOpen) return;
      if (e.target.closest('.softKb')) return;
      if (e.target.id === 'searchInput' || e.target.id === 'noteInput') return;
      closeKb();
    });
    $('noteBack').addEventListener('click', function () {
      closeKb();
      showSheet('searchSheet');
      loadHistoryList();
    });
    $('continueBtn').addEventListener('click', function () {
      if (!noteStr.trim()) return;
      closeKb();
      saveHistory(targetUser.uid);
      $('confirmNote').textContent = noteStr;
      renderBalance();
      showSheet('confirmSheet');
    });
    $('styleBtn').addEventListener('click', function () {
      if (noteStr.indexOf('✨') !== -1) return;
      noteStr = noteStr + ' ✨';
      $('confirmNote').textContent = noteStr;
    });
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
          .then(r => r.json())
          .then(function (d) {
            payBusy = false;
            if (!d || !d.ok) {
              hideSheets();
              if (d && /Insufficient/.test(d.msg || '')) {
                if (d.balance != null) balance = Number(d.balance);
                renderBalance();
                showAlert();
              } else if (d && /kicked|Session/.test(d.msg || '')) {
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
            payBusy = false;
            hideSheets();
            alert('Network error, payment failed, balance unchanged.');
          });
      }, wait);
    });
    $('alertOk').addEventListener('click', function () {
      $('alertMask').classList.remove('open');
      showSheet('confirmSheet');
    });
    $('kickOk').addEventListener('click', function () {
      localStorage.removeItem('uid');
      localStorage.removeItem('clientId');
      location.replace('/');
    });
    $('receiptBtn').addEventListener('click', function () {
      var name = targetUser ? (targetUser.nickname || targetUser.uid) : '';
      alert('Receipt\n\nTo: ' + name + ' ($' + (targetUser ? targetUser.uid : '') + ')\n' +
        'Amount: $' + money2(parseFloat(amountStr)) + '\n' +
        'Note: ' + noteStr + '\n' +
        'Status: Completed');
    });
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
