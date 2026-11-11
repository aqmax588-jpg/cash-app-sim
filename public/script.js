/* =========================================================
Cash App Simulator｜BUG修复完整版
修复：搜索无兜底、真实头像不加载、历史被兜底覆盖、新输入无法选中
========================================================= */
(function () {
  'use strict';
  var API = '/api';
  var $ = function (id) { return document.getElementById(id); };
  var uid = localStorage.getItem('uid') || '';
  var clientId = localStorage.getItem('clientId') || '';

  // 历史ID列表缓存
  function getHistoryCache(){
    const str = localStorage.getItem('cash_history_'+uid);
    if(str) return JSON.parse(str);
    return [];
  }
  function setHistoryCache(arr){
    localStorage.setItem('cash_history_'+uid, JSON.stringify(arr.slice(0,8)));
  }

  // 用户资料缓存：昵称、头像
  function getUserProfileCache(cashtag){
    const key = 'cash_profile_' + cashtag;
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(Date.now() - obj.time > 12 * 3600 * 1000) return null;
    return obj.data;
  }
  function setUserProfileCache(cashtag, data){
    const key = 'cash_profile_' + cashtag;
    localStorage.setItem(key, JSON.stringify({ data:data, time:Date.now() }));
  }

  if (!uid || !clientId) {
    location.replace('/');
    return;
  }

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
    av.textContent = initial(myNickname);
    av.style.background = colorOf(uid);
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
  // 生成兜底用户，兜底也会缓存
  function makeDemoUser(raw) {
    var name = String(raw || '').replace(/^\$/g, '').replace(/\s+/g, '');
    if (!name) name = 'user';
    const cache = getUserProfileCache(name);
    if(cache) return cache;
    const demoObj = {
      uid: name,
      nickname: name.charAt(0).toUpperCase() + name.slice(1),
      avatar: '',
      avatarFallback: ''
    };
    setUserProfileCache(name, demoObj);
    return demoObj;
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
  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 260);
  }
  function clearResults() {
    $('resultsList').innerHTML = '';
  }

  // 加载历史列表
  function loadHistoryList() {
    console.log('====打开搜索页，加载历史====');
    clearResults();
    const localIds = getHistoryCache();
    if(localIds && Array.isArray(localIds) && localIds.length>0){
      localIds.forEach(id=>{
        const cached = getUserProfileCache(id);
        const user = cached ? cached : makeDemoUser(id);
        $('resultsList').appendChild(makeRow(user));
      })
    }else{
      renderEmptyState('No recent contacts. Type a $Cashtag to search.');
    }
    //后台同步后端历史
    (async function backgroundSyncHistory(){
      try {
        const url = API + '/user/search-history/' + encodeURIComponent(uid);
        const resHist = await fetch(url, {signal:AbortSignal.timeout(3000)});
        const dataHist = await resHist.json();
        if (!dataHist || !dataHist.ok || !Array.isArray(dataHist.list) || dataHist.list.length === 0) return;
        setHistoryCache(dataHist.list.slice(0,8));
        clearResults();
        dataHist.list.slice(0,8).forEach(id=>{
          const cached = getUserProfileCache(id);
          const user = cached ? cached : makeDemoUser(id);
          $('resultsList').appendChild(makeRow(user));
        })
      }catch(err){
        console.log("后台同步历史超时",err);
      }
    })();
  }

  // 【重点修复】搜索逻辑，新输入一定有结果，可点击
  function renderResults() {
    var q = searchStr.trim().replace(/^\$/g, '');
    var seq = ++searchSeq;
    clearResults();
    if (!q) {
      loadHistoryList();
      return;
    }
    $('resultsHead').textContent = 'RESULTS';
    // 优先读本地缓存
    const cached = getUserProfileCache(q);
    if(cached){
      $('resultsList').appendChild(makeRow(cached));
      return;
    }
    // 请求lookup接口
    fetch(API + '/user/lookup/' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (seq !== searchSeq) return;
        clearResults();
        if (data && data.ok && data.user) {
          setUserProfileCache(q, data.user);
          $('resultsList').appendChild(makeRow(data.user));
        } else {
          // 接口失败/查无此人 → 兜底
          const demo = makeDemoUser(q);
          $('resultsList').appendChild(makeRow(demo));
        }
      })
      .catch(function () {
        if (seq !== searchSeq) return;
        clearResults();
        const demo = makeDemoUser(q);
        $('resultsList').appendChild(makeRow(demo));
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
      console.log("save‑search resp",ret);
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
        renderBalance();
        renderMe();
      })
      .catch(function () {});
    kickTimer = setInterval(checkKick, 9000);
  }
  function bind() {
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
    $('searchInput').addEventListener('click', function () { openKb('search'); });
    $('searchClear').addEventListener('click', function (e) {
      e.stopPropagation();
      searchStr = '';
      $('searchInput').value = '';
      $('searchBox').classList.remove('has-value');
      loadHistoryList();
    });
    $('noteInput').addEventListener('click', function () { openKb('note'); });
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
