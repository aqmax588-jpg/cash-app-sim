const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 内存存储（重启丢失，演示用）
const users = new Map();
// 登录会话：sessionId -> userId
const sessions = new Map();
// 账号在线标记：userId -> 唯一session，实现互踢
const onlineUser = new Map();
// 交易流水
const records = [];

// 初始化一个测试账号，余额随机 150万 ~ 200万 USD
const initUserId = "demo001";
const initBalance = (Math.random() * (2000000 - 1500000) + 1500000).toFixed(2);
users.set(initUserId, {
  id: initUserId,
  password: "123456",
  balance: Number(initBalance),
  nickname: "rose",
  avatar: ""
});

// 登录接口，单点互踢
app.post('/api/login', (req, res) => {
  const { uid, pwd } = req.body;
  const user = users.get(uid);
  if (!user || user.password !== pwd) {
    return res.json({ ok: false, msg: "Wrong account or password" });
  }
  // 踢掉之前的登录会话
  const oldSession = onlineUser.get(uid);
  if (oldSession) {
    sessions.delete(oldSession);
  }
  const sid = uuidv4();
  sessions.set(sid, uid);
  onlineUser.set(uid, sid);
  res.json({ ok: true, sessionId: sid, user: { id: uid, balance: user.balance, nickname: user.nickname } });
});

// 校验会话
function checkSession(req, res, next) {
  const sid = req.headers['x-session-id'];
  if (!sid || !sessions.has(sid)) {
    return res.json({ ok: false, needLogin: true });
  }
  req.uid = sessions.get(sid);
  next();
}

// 获取用户信息
app.get('/api/user', checkSession, (req, res) => {
  const u = users.get(req.uid);
  res.json({ ok: true, user: u });
});

// 支付扣款接口
app.post('/api/pay', checkSession, (req, res) => {
  const { amount, note, targetId } = req.body;
  const user = users.get(req.uid);
  const payNum = Number(amount);
  if (user.balance < payNum) {
    return res.json({ ok: false, msg: "Insufficient balance" });
  }
  user.balance = Number((user.balance - payNum).toFixed(2));
  // 写入交易记录
  const tx = {
    id: uuidv4(),
    time: new Date().toISOString(),
    amount: payNum,
    note,
    targetId,
    from: req.uid
  };
  records.push(tx);
  res.json({ ok: true, newBalance: user.balance, tx });
});

// 获取交易流水
app.get('/api/records', checkSession, (req, res) => {
  res.json({ ok: true, list: records.filter(r => r.from === req.uid).reverse() });
});

// 搜索用户（模拟ID查找，头像预留接口位置）
app.get('/api/search-user', (req, res) => {
  const targetId = req.query.id;
  if (users.has(targetId)) {
    const u = users.get(targetId);
    // 这里预留：后续替换成真实头像API
    return res.json({ ok: true, user: { ...u, avatar: u.avatar } });
  }
  return res.json({ ok: false, msg: "User not found" });
});

// 管理端：新增账号，随机余额 150w-200w
app.post('/api/admin/add-user', (req, res) => {
  const { uid, pwd, nickname } = req.body;
  if (users.has(uid)) return res.json({ ok: false, msg: "Account exists" });
  const bal = (Math.random() * (2000000 - 1500000) + 1500000).toFixed(2);
  users.set(uid, {
    id: uid,
    password: pwd,
    balance: Number(bal),
    nickname,
    avatar: ""
  });
  res.json({ ok: true, user: users.get(uid) });
});

// 管理端：给账号充值
app.post('/api/admin/recharge', (req, res) => {
  const { uid, addAmount } = req.body;
  if (!users.has(uid)) return res.json({ ok: false, msg: "Account not found" });
  const u = users.get(uid);
  u.balance = Number((u.balance + Number(addAmount)).toFixed(2));
  res.json({ ok: true, newBalance: u.balance });
});

// 登出
app.post('/api/logout', checkSession, (req, res) => {
  const sid = req.headers['x-session-id'];
  const uid = req.uid;
  sessions.delete(sid);
  if (onlineUser.get(uid) === sid) onlineUser.delete(uid);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
