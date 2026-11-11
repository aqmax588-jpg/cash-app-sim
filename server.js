const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 管理员账号
const ADMIN = {
  username: "admin",
  password: "admin123"
};

// 内存存储
let users = [];
let sessions = {}; // 在线会话，用于互踢
let transactionRecords = [];

// 管理员登录接口
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN.username && password === ADMIN.password) {
    return res.json({ ok: true, msg: "admin login success" });
  }
  return res.json({ ok: false, msg: "wrong admin account or password" });
});

// 用户登录接口 + 互踢逻辑
app.post('/api/user/login', (req, res) => {
  const { uid, password, clientId } = req.body;
  const user = users.find(u => u.uid === uid && u.password === password);
  if (!user) {
    return res.json({ ok: false, msg: "User not found or wrong password" });
  }
  // 踢掉之前的会话
  if (sessions[uid]) {
    sessions[uid].kicked = true;
  }
  sessions[uid] = { clientId, kicked: false };
  return res.json({
    ok: true,
    user: { uid: user.uid, nickname: user.nickname, balance: user.balance, avatar: user.avatar },
    msg: "Login success"
  });
});

// 检查是否被踢
app.post('/api/user/check-kick', (req, res) => {
  const { uid, clientId } = req.body;
  const s = sessions[uid];
  if (!s || s.kicked || s.clientId !== clientId) {
    return res.json({ kicked: true });
  }
  return res.json({ kicked: false });
});

// 管理员新增用户，余额随机 150w ~ 200w
app.post('/api/admin/add-user', (req, res) => {
  const { uid, password, nickname, avatar } = req.body;
  if (users.find(u => u.uid === uid)) {
    return res.json({ ok: false, msg: "This ID already exists" });
  }
  const balance = Math.floor(1500000 + Math.random() * 500000);
  const newUser = { uid, password, nickname, avatar, balance };
  users.push(newUser);
  return res.json({ ok: true, user: newUser });
});

// 获取全部用户列表
app.get('/api/admin/users', (req, res) => {
  res.json(users);
});

// 管理员修改余额
app.post('/api/admin/set-balance', (req, res) => {
  const { uid, newBalance } = req.body;
  const u = users.find(x => x.uid === uid);
  if (!u) return res.json({ ok: false });
  u.balance = Number(newBalance);
  return res.json({ ok: true, user: u });
});

// 充值交易接口，余额校验，不能负数
app.post('/api/user/pay', (req, res) => {
  const { uid, amount, remark, targetId, targetNick, targetAvatar } = req.body;
  const user = users.find(u => u.uid === uid);
  if (!user) return res.json({ ok: false, msg: "User not found" });
  if (user.balance < Number(amount)) {
    return res.json({ ok: false, msg: "Insufficient balance, payment failed" });
  }
  user.balance -= Number(amount);
  const record = {
    time: new Date().toLocaleString(),
    uid,
    amount: Number(amount),
    remark,
    targetId,
    targetNick,
    targetAvatar
  };
  transactionRecords.push(record);
  return res.json({ ok: true, user, record });
});

// 获取该用户的交易流水
app.get('/api/user/records/:uid', (req, res) => {
  const uid = req.params.uid;
  const list = transactionRecords.filter(r => r.uid === uid);
  res.json(list);
});

// 历史搜索记录（用户搜索过的ID）
let searchHistory = {};
app.post('/api/user/save-search', (req, res) => {
  const { uid, searchId } = req.body;
  if (!searchHistory[uid]) searchHistory[uid] = [];
  if (!searchHistory[uid].includes(searchId)) {
    searchHistory[uid].push(searchId);
  }
  res.json({ ok: true });
});
app.get('/api/user/search-history/:uid', (req, res) => {
  const uid = req.params.uid;
  res.json(searchHistory[uid] || []);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/cash', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/cash.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
