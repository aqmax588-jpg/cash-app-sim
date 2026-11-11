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

// 内存存储（Render 内存型，重启丢失，后续对接后端再换数据库）
let users = [];
let sessions = {};
let transactionRecords = [];
let searchHistory = {};

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN.username && password === ADMIN.password) {
    return res.json({ ok: true, msg: "登录成功" });
  }
  return res.json({ ok: false, msg: "账号或密码错误" });
});

// 用户登录 + 互踢
app.post('/api/user/login', (req, res) => {
  const { uid, password, clientId } = req.body;
  const user = users.find(u => u.uid === uid && u.password === password);
  if (!user) {
    return res.json({ ok: false, msg: "用户不存在或密码错误" });
  }
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

// 检测是否被踢下线
app.post('/api/user/check-kick', (req, res) => {
  const { uid, clientId } = req.body;
  const s = sessions[uid];
  if (!s || s.kicked || s.clientId !== clientId) {
    return res.json({ kicked: true });
  }
  return res.json({ kicked: false });
});

// 管理员新增用户，余额 150w ~ 200w 随机
app.post('/api/admin/add-user', (req, res) => {
  const { uid, password, nickname, avatar } = req.body;
  if (users.find(u => u.uid === uid)) {
    return res.json({ ok: false, msg: "该 ID 已存在" });
  }
  const balance = Math.floor(1500000 + Math.random() * 500000);
  const newUser = { uid, password, nickname, avatar, balance };
  users.push(newUser);
  return res.json({ ok: true, user: newUser });
});

// 获取全部用户
app.get('/api/admin/users', (req, res) => {
  res.json(users);
});

// 修改余额
app.post('/api/admin/set-balance', (req, res) => {
  const { uid, newBalance } = req.body;
  const u = users.find(x => x.uid === uid);
  if (!u) return res.json({ ok: false });
  u.balance = Number(newBalance);
  return res.json({ ok: true, user: u });
});

// 交易提交，余额不足拦截，禁止负数
app.post('/api/user/pay', (req, res) => {
  const { uid, amount, remark, targetId, targetNick, targetAvatar } = req.body;
  const user = users.find(u => u.uid === uid);
  if (!user) return res.json({ ok: false, msg: "User not found" });
  const payAmount = Number(amount);
  if (user.balance < payAmount) {
    return res.json({ ok: false, msg: "Insufficient balance, payment failed" });
  }
  user.balance -= payAmount;
  const record = {
    time: new Date().toLocaleString(),
    uid,
    amount: payAmount,
    remark,
    targetId,
    targetNick,
    targetAvatar
  };
  transactionRecords.push(record);
  return res.json({ ok: true, user, record });
});

// 获取用户交易流水
app.get('/api/user/records/:uid', (req, res) => {
  const uid = req.params.uid;
  const list = transactionRecords.filter(r => r.uid === uid);
  res.json(list);
});

// 保存搜索历史
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

// 路由
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
