const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   ★★★ 头像 / 昵称 / ID 数据源 ★★★
   以后换地址，有两个地方可以改，优先级：环境变量 > 下面这行默认值
   1) Render 后台 → Environment → 新增变量 AVATAR_API_BASE（推荐，改完自动重启，不用动代码）
   2) 或者直接改下面这行默认值，再推 GitHub
   ============================================================ */
const AVATAR_API_BASE = (process.env.AVATAR_API_BASE || 'https://offset-nominations-reductions-length.trycloudflare.com').replace(/\/+$/, '');

/* 单次请求超时（毫秒）。家里电脑冷启动要拉一次上游，给足 15 秒 */
const AVATAR_API_TIMEOUT = Number(process.env.AVATAR_API_TIMEOUT || 15000);

/* 成功结果在内存里缓存 10 分钟，减少打到你电脑的次数、也更快 */
const PROFILE_CACHE_TTL = 10 * 60 * 1000;
const profileCache = new Map();   // tag -> { data, time }

/* ============ 管理员固定账号 ============ */
const ADMIN = { username: 'admin', password: 'admin123' };

/* ============ 内存数据 ============ */
let users = [];            // { uid, password, nickname, avatar, balance }
let sessions = {};         // uid -> { clientId, kicked }
let records = [];          // 交易流水
let searchHistory = {};    // uid -> [ 搜索过的ID ]

/* 余额随机 1500000 ~ 2000000 */
function randomBalance() {
  return Math.floor(1500000 + Math.random() * 500000);
}

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

/* ============================================================
   资料接口：GET {BASE}/api/profile?tag=xxx
   返回 { ok, cashtag, display_name, avatar, avatar_proxy }
   这里统一转成前端能直接用的结构：{ id, nickname, avatar, avatarFallback }
   avatar 一定是完整 URL（走你电脑的图片中转，避免国内直连 S3 被 403）
   ============================================================ */
function toAbsolute(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  return AVATAR_API_BASE + '/' + u.replace(/^\/+/, '');
}

async function fetchProfileOnce(tag) {
  const url = AVATAR_API_BASE + '/api/profile?tag=' + encodeURIComponent(tag);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AVATAR_API_TIMEOUT);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'accept': 'application/json' }
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }

    if (!resp.ok || !json || json.ok === false) {
      console.log('[avatar] 接口返回异常', resp.status, String(text).slice(0, 120));
      return null;
    }

    const avatarProxy = json.avatar_proxy ? toAbsolute(json.avatar_proxy) : '';
    const avatarOrigin = json.avatar ? toAbsolute(json.avatar) : '';
    const avatar = avatarProxy || avatarOrigin;
    if (!avatar) return null;

    return {
      id: String(json.cashtag || tag).replace(/^\$/, ''),
      nickname: String(json.display_name || '').trim(),
      avatar: avatar,
      avatarFallback: avatarOrigin
    };
  } catch (e) {
    console.log('[avatar] 请求失败', e && e.name === 'AbortError' ? '超时' : (e && e.message));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* 带缓存 + 一次重试 */
async function fetchAvatarProfile(rawId) {
  const tag = String(rawId || '').replace(/^\$+/g, '').trim();
  if (!tag) return null;

  const key = tag.toLowerCase();
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.time < PROFILE_CACHE_TTL) {
    return hit.data;
  }

  let data = await fetchProfileOnce(tag);
  if (!data) {
    await new Promise(function (r) { setTimeout(r, 800); });
    data = await fetchProfileOnce(tag);
  }

  if (data) profileCache.set(key, { data: data, time: Date.now() });
  return data;
}

/* ============ 管理员接口 ============ */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN.username && password === ADMIN.password) {
    return res.json({ ok: true, msg: '登录成功' });
  }
  return res.json({ ok: false, msg: '管理员账号或密码错误' });
});

app.post('/api/admin/add-user', (req, res) => {
  const { uid, password, nickname, avatar } = req.body;
  if (!uid || !password) {
    return res.json({ ok: false, msg: '用户ID和密码不能为空' });
  }
  if (users.find(u => u.uid === uid)) {
    return res.json({ ok: false, msg: '该用户ID已存在' });
  }
  const user = {
    uid: String(uid).trim(),
    password: String(password).trim(),
    nickname: (nickname || uid).trim(),
    avatar: (avatar || '').trim(),
    balance: randomBalance()
  };
  users.push(user);
  return res.json({ ok: true, msg: '添加成功，初始余额 $' + user.balance.toLocaleString(), user });
});

app.get('/api/admin/users', (req, res) => {
  res.json({ ok: true, list: users });
});

app.post('/api/admin/set-balance', (req, res) => {
  const { uid, newBalance } = req.body;
  const u = users.find(x => x.uid === uid);
  if (!u) return res.json({ ok: false, msg: '用户不存在' });
  u.balance = Number(newBalance) || 0;
  return res.json({ ok: true, msg: '余额已更新', user: u });
});

/* 设置用户头像：传 cashtag（不带 $），走后端接口取真实头像 + 昵称 */
app.post('/api/admin/set-avatar', async (req, res) => {
  const { uid, cashtag } = req.body;
  const u = users.find(x => x.uid === uid);
  if (!u) return res.json({ ok: false, msg: '用户不存在' });

  const tag = String(cashtag || '').replace(/^\$/, '').trim();
  if (!tag) return res.json({ ok: false, msg: 'cashtag 不能为空' });

  const profile = await fetchAvatarProfile(tag);
  if (!profile) {
    return res.json({ ok: false, msg: '没取到该 cashtag 的头像（接口不通或该账号无头像）' });
  }

  u.avatar = profile.avatar;
  u.avatarFallback = profile.avatarFallback || '';
  if (profile.nickname) u.nickname = profile.nickname;

  return res.json({ ok: true, msg: '头像已更新', user: u });
});

/* 管理后台：全部交易流水 */
app.get('/api/admin/logs', (req, res) => {
  res.json({ ok: true, list: records.slice().reverse() });
});

/* 管理后台：踢下线 */
app.post('/api/admin/kick', (req, res) => {
  const { uid } = req.body;
  if (sessions[uid]) sessions[uid].kicked = true;
  return res.json({ ok: true, msg: '已踢下线' });
});

/* ============ 用户接口 ============ */
app.post('/api/user/login', (req, res) => {
  const { uid, password, clientId } = req.body;
  const user = users.find(u => u.uid === String(uid).trim() && u.password === String(password).trim());
  if (!user) {
    return res.json({ ok: false, msg: '用户不存在或密码错误' });
  }
  // 顶掉上一个会话
  if (sessions[user.uid]) sessions[user.uid].kicked = true;
  sessions[user.uid] = { clientId, kicked: false };

  return res.json({
    ok: true,
    user: {
      uid: user.uid,
      nickname: user.nickname,
      avatar: user.avatar,
      avatarFallback: user.avatarFallback || '',
      balance: user.balance
    }
  });
});

app.post('/api/user/check-kick', (req, res) => {
  const { uid, clientId } = req.body;
  const s = sessions[uid];
  if (!s || s.kicked || s.clientId !== clientId) {
    return res.json({ kicked: true });
  }
  return res.json({ kicked: false });
});

app.post('/api/user/info', (req, res) => {
  const { uid, clientId } = req.body;
  const user = users.find(u => u.uid === uid);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });
  const s = sessions[uid];
  if (!s || s.clientId !== clientId || s.kicked) {
    return res.json({ ok: false, msg: 'kicked' });
  }
  return res.json({
    ok: true,
    user: {
      uid: user.uid,
      nickname: user.nickname,
      avatar: user.avatar,
      avatarFallback: user.avatarFallback || '',
      balance: user.balance
    }
  });
});

/* 搜索收款人：本地用户优先，没有则查外部接口，最后兜底 */
app.get('/api/user/lookup/:uid', async (req, res) => {
  const raw = String(req.params.uid || '').trim();
  const uid = raw.replace(/^\$+/g, '');
  if (!uid) return res.json({ ok: false, msg: 'No user found' });

  // 1. 本站注册用户（真实数据）
  const user = users.find(u => u.uid === uid);
  if (user) {
    return res.json({
      ok: true,
      source: 'local',
      user: {
        uid: user.uid,
        nickname: user.nickname,
        avatar: user.avatar,
        avatarFallback: user.avatarFallback || '',
        balance: user.balance
      }
    });
  }

  // 2. 外部接口（真实头像 / 昵称 / ID）
  const profile = await fetchAvatarProfile(uid);
  if (profile) {
    return res.json({
      ok: true,
      source: 'api',
      user: {
        uid: profile.id || uid,
        nickname: profile.nickname || uid,
        avatar: profile.avatar,
        avatarFallback: profile.avatarFallback || ''
      }
    });
  }

  // 3. 兜底（接口不通时不让流程中断，前端不会显示任何 DEMO 标记）
  return res.json({
    ok: true,
    source: 'fallback',
    user: {
      uid: uid,
      nickname: uid.charAt(0).toUpperCase() + uid.slice(1),
      avatar: '',
      avatarFallback: ''
    }
  });
});

/* 支付 */
app.post('/api/user/pay', (req, res) => {
  const { uid, clientId, amount, remark, targetUid } = req.body;
  const user = users.find(u => u.uid === uid);
  if (!user) return res.json({ ok: false, msg: 'User not found' });

  const s = sessions[uid];
  if (!s || s.clientId !== clientId || s.kicked) {
    return res.json({ ok: false, msg: 'Session expired' });
  }

  const payAmount = Number(amount);
  if (!payAmount || payAmount <= 0) {
    return res.json({ ok: false, msg: 'Invalid amount' });
  }
  if (user.balance < payAmount) {
    return res.json({ ok: false, msg: 'Insufficient balance', balance: user.balance });
  }

  const target = users.find(u => u.uid === targetUid);
  user.balance = Number((user.balance - payAmount).toFixed(2));

  const record = {
    recordId: 'TX' + Date.now() + Math.floor(Math.random() * 1000),
    time: now(),
    timestamp: Date.now(),
    uid: user.uid,
    nickname: user.nickname,
    amount: payAmount,
    remark: remark || '',
    targetUid: targetUid,
    targetNick: target ? target.nickname : targetUid,
    targetAvatar: target ? target.avatar : '',
    balanceAfter: user.balance
  };
  records.push(record);

  return res.json({
    ok: true,
    balance: user.balance,
    record
  });
});

/* 我的交易流水 */
app.get('/api/user/records/:uid', (req, res) => {
  const list = records
    .filter(r => r.uid === req.params.uid)
    .sort((a, b) => b.timestamp - a.timestamp);
  res.json({ ok: true, list });
});

/* 搜索历史 */
app.post('/api/user/save-search', (req, res) => {
  const { uid, searchId } = req.body;
  if (!uid || !searchId) return res.json({ ok: false });
  if (!searchHistory[uid]) searchHistory[uid] = [];
  searchHistory[uid] = searchHistory[uid].filter(x => x !== searchId);
  searchHistory[uid].unshift(searchId);
  if (searchHistory[uid].length > 8) searchHistory[uid].pop();
  return res.json({ ok: true });
});

app.get('/api/user/search-history/:uid', (req, res) => {
  res.json({ ok: true, list: searchHistory[req.params.uid] || [] });
});

/* ============ 自检接口（部署后先访问这个确认能通） ============ */
app.get('/api/source-check', async (req, res) => {
  const tag = String(req.query.tag || 'rose').replace(/^\$+/g, '');
  const start = Date.now();
  const data = await fetchProfileOnce(tag);
  res.json({
    ok: !!data,
    upstream: AVATAR_API_BASE,
    timeout: AVATAR_API_TIMEOUT,
    cost_ms: Date.now() - start,
    sample_tag: tag,
    result: data,
    hint: data ? '数据源正常' : '数据源不通：检查你电脑的 server.py 和 cloudflared 是否在跑、地址是否过期'
  });
});

/* ============ 页面路由 ============ */
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/cash', (req, res) => res.sendFile(path.join(__dirname, 'public/cash.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

/* 兜底 */
app.use((req, res) => res.status(404).send('Not Found'));

/* ============ 启动（显式绑 0.0.0.0，并打印诊断信息） ============ */
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, function () {
  console.log('[boot] 1/2 listening on ' + HOST + ':' + PORT);
  console.log('[boot] 2/2 avatar source = ' + AVATAR_API_BASE);
});

server.on('error', function (e) {
  console.error('[boot] listen error: ' + (e && e.message));
  process.exit(1);
});

process.on('uncaughtException', function (e) {
  console.error('[fatal] uncaughtException: ' + (e && e.stack ? e.stack : e));
});

process.on('unhandledRejection', function (e) {
  console.error('[fatal] unhandledRejection: ' + (e && e.stack ? e.stack : e));
});
