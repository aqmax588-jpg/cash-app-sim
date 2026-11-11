const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   ★★★ 头像 / 昵称 / ID 查询接口（唯一需要更换的地方）★★★
   接口失效或换服务时，只改下面这一个地址即可，其他代码不用动
   ============================================================ */
const AVATAR_API_BASE = 'https://offset-nominations-reductions-length.trycloudflare.com/';
/* 单次请求超时（毫秒），接口慢可以适当调大 */
const AVATAR_API_TIMEOUT = 1500;

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

/* 设置头像：传 cashtag（不带 $），走 unavatar 拉 Cash App 公开头像 */
app.post('/api/admin/set-avatar', (req, res) => {
  const { uid, cashtag } = req.body;
  const u = users.find(x => x.uid === uid);
  if (!u) return res.json({ ok: false, msg: '用户不存在' });
  const tag = String(cashtag || '').replace(/^\$/, '').trim();
  if (!tag) return res.json({ ok: false, msg: 'cashtag 不能为空' });
  u.avatar = 'https://unavatar.io/cashapp/' + encodeURIComponent(tag);
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
    user: { uid: user.uid, nickname: user.nickname, avatar: user.avatar, balance: user.balance }
  });
});

/* 搜索收款人 */
/* ---------- 头像接口解析辅助 ---------- */
function pickField(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return String(obj[k]).trim();
    }
  }
  return '';
}

function unwrapProfile(json) {
  // 兼容多种返回层级：直接对象 / data / user / result / profile / info
  let node = json;
  if (node && typeof node === 'object') {
    const nested = node.data || node.user || node.result || node.profile || node.info || node.record;
    if (nested && typeof nested === 'object') node = nested;
  }
  if (!node || typeof node !== 'object') return null;

  const avatar = pickField(node, ['avatar', 'avatarUrl', 'avatar_url', 'image', 'img', 'picture', 'profile_image_url', 'profileImage', 'profile_image']);
  if (!avatar) return null;

  const nickname = pickField(node, ['nickname', 'name', 'displayName', 'display_name', 'username', 'cashtag']);
  const id = pickField(node, ['id', 'cashtag', 'uid', 'userId', 'user_id', 'uuid', 'username']);

  return { avatar, nickname, id };
}

/* 调用外部接口取真实头像，失败返回 null（绝不抛错，保证流程不中断） */
async function fetchAvatarProfile(rawId) {
  const id = String(rawId || '').replace(/^\$/g, '').trim();
  if (!id) return null;

  const base = AVATAR_API_BASE.replace(/\/+$/, '');
  const enc = encodeURIComponent(id);

  // 依次尝试常见路径与参数名，命中任一即可
  const urls = [
    base + '/?id=' + enc,
    base + '/?q=' + enc,
    base + '/?cashtag=' + enc,
    base + '/?username=' + enc,
    base + '/api?id=' + enc,
    base + '/avatar/' + enc,
    base + '/' + enc,
    AVATAR_API_BASE + '?id=' + enc
  ];

  // 逐个探测单个地址，成功返回资料，否则返回 null
  async function tryOne(url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), AVATAR_API_TIMEOUT);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return null;

      const ct = resp.headers.get('content-type') || '';
      // 有些接口直接把图片返回
      if (ct.startsWith('image/')) {
        return { avatar: url, nickname: '', id: id };
      }

      const text = await resp.text();
      if (!text) return null;

      let json = null;
      try { json = JSON.parse(text); } catch (e) { return null; }

      const got = unwrapProfile(json);
      if (!got) return null;

      // 相对路径补全
      if (!/^https?:\/\//.test(got.avatar) && got.avatar.indexOf('data:') !== 0) {
        got.avatar = base + '/' + got.avatar.replace(/^\/+/, '');
      }
      return got;
    } catch (e) {
      return null;
    }
  }

  // 并发探测所有候选地址，取第一个成功的结果
  const settled = await Promise.allSettled(urls.map(function (u) { return tryOne(u); }));
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'fulfilled' && settled[i].value) {
      return settled[i].value;
    }
  }
  return null;
}

/* 搜索收款人：本地用户优先，没有则查外部头像接口，最后兜底虚拟用户 */
app.get('/api/user/lookup/:uid', async (req, res) => {
  const raw = String(req.params.uid || '').trim();
  const uid = raw.replace(/^\$/g, '');
  if (!uid) return res.json({ ok: false, msg: 'No user found' });

  // 1. 本站注册用户（真实数据）
  const user = users.find(u => u.uid === uid);
  if (user) {
    return res.json({
      ok: true,
      source: 'local',
      user: { uid: user.uid, nickname: user.nickname, avatar: user.avatar, balance: user.balance }
    });
  }

  // 2. 外部头像接口（真实头像 / 昵称 / ID）
  const profile = await fetchAvatarProfile(uid);
  if (profile) {
    return res.json({
      ok: true,
      source: 'api',
      user: {
        uid: profile.id || uid,
        nickname: profile.nickname || uid,
        avatar: profile.avatar
      }
    });
  }

  // 3. 兜底虚拟用户（前端不显示任何 DEMO 标记，外观与真实一致）
  return res.json({
    ok: true,
    source: 'fallback',
    user: {
      uid: uid,
      nickname: uid.charAt(0).toUpperCase() + uid.slice(1),
      avatar: ''
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

/* ============ 页面路由 ============ */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/cash', (req, res) => res.sendFile(path.join(__dirname, 'public/cash.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

/* 兜底 */
app.use((req, res) => res.status(404).send('Not Found'));

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
