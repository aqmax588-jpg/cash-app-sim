const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

const app = express()
const PORT = process.env.PORT || 3000
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

const DB_FILE = path.join(__dirname, 'db.json')
const loadDB = () => {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      admin: { username: 'admin', password: 'admin123' },
      accounts: [],
      sessions: [],
      recharge_logs: [],
      pay_logs: []
    }, null, 2))
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
}
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))

// 随机初始余额 1500000 ~ 2000000
const randomBalance = () => {
  const min = 1500000
  const max = 2000000
  return Number((Math.random() * (max - min) + min).toFixed(2))
}

// 踢掉该账号全部旧会话
const kickOldSession = (accountId, newDeviceId) => {
  const db = loadDB()
  db.sessions = db.sessions.filter(s => {
    if (s.accountId === accountId) {
      return s.deviceId === newDeviceId
    }
    return true
  })
  saveDB(db)
}

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body
  const db = loadDB()
  if (db.admin.username === username && db.admin.password === password) {
    const token = uuidv4()
    res.json({ ok: true, token })
  } else {
    res.json({ ok: false, msg: '账号密码错误' })
  }
})

// 创建账号
app.post('/api/admin/create-account', (req, res) => {
  const { username, password, bindTimes } = req.body
  const db = loadDB()
  const exists = db.accounts.find(a => a.username === username)
  if (exists) return res.json({ ok: false, msg: '账号已存在' })
  const newAcc = {
    id: uuidv4(),
    username,
    password,
    balance: randomBalance(),
    bindTimes: Number(bindTimes),
    avatarId: '',
    avatarUrl: ''
  }
  db.accounts.push(newAcc)
  saveDB(db)
  res.json({ ok: true, account: newAcc })
})

// 获取账号列表
app.get('/api/admin/accounts', (req, res) => {
  const db = loadDB()
  res.json({ ok: true, list: db.accounts })
})

// 管理员充值，写入充值流水（真实记录）
app.post('/api/admin/recharge', (req, res) => {
  const { accountId, amount } = req.body
  const db = loadDB()
  const acc = db.accounts.find(a => a.id === accountId)
  if (!acc) return res.json({ ok: false, msg: '账号不存在' })
  const addAmt = Number(amount)
  acc.balance = Number((acc.balance + addAmt).toFixed(2))
  db.recharge_logs.push({
    logId: uuidv4(),
    accountId,
    username: acc.username,
    amount: addAmt,
    time: new Date().toLocaleString(),
    timestamp: Date.now()
  })
  saveDB(db)
  res.json({ ok: true, balance: acc.balance })
})

// 获取全部流水（管理端）
app.get('/api/admin/logs', (req, res) => {
  const db = loadDB()
  const allLogs = [
    ...db.recharge_logs.map(i => ({ ...i, type: 'admin_recharge' })),
    ...db.pay_logs.map(i => ({ ...i, type: 'user_pay' }))
  ].sort((a, b) => b.timestamp - a.timestamp)
  res.json({ ok: true, list: allLogs })
})

// 强制踢下线
app.post('/api/admin/kick', (req, res) => {
  const { accountId } = req.body
  const db = loadDB()
  db.sessions = db.sessions.filter(s => s.accountId !== accountId)
  saveDB(db)
  res.json({ ok: true })
})

// 设置头像ID，unavatar.io 拉取 Cash App 真实头像
app.post('/api/admin/set-avatar', (req, res) => {
  const { accountId, avatarId } = req.body
  const db = loadDB()
  const acc = db.accounts.find(a => a.id === accountId)
  if (!acc) return res.json({ ok: false, msg: '账号不存在' })
  acc.avatarId = avatarId
  // unavatar cashapp 接口，cashtag 不带 $
  acc.avatarUrl = `https://unavatar.io/cashapp/${encodeURIComponent(avatarId)}`
  saveDB(db)
  res.json({ ok: true, avatarUrl: acc.avatarUrl })
})

// 用户登录
app.post('/api/user/login', (req, res) => {
  const { username, password, deviceId } = req.body
  const db = loadDB()
  const acc = db.accounts.find(a => a.username === username && a.password === password)
  if (!acc) return res.json({ ok: false, msg: '账号密码错误' })

  const hasThisDevice = db.sessions.some(s => s.accountId === acc.id && s.deviceId === deviceId)
  if (!hasThisDevice) {
    if (acc.bindTimes <= 0) {
      return res.json({ ok: false, msg: '换绑次数已用完，无法在新设备登录' })
    }
    acc.bindTimes -= 1
  }
  kickOldSession(acc.id, deviceId)
  const token = uuidv4()
  db.sessions.push({
    token,
    accountId: acc.id,
    deviceId,
    createAt: Date.now()
  })
  saveDB(db)
  res.json({
    ok: true,
    token,
    account: acc
  })
})

// 获取账号信息 + 该账号自己的支付流水
app.post('/api/user/info', (req, res) => {
  const { token, deviceId } = req.body
  const db = loadDB()
  const session = db.sessions.find(s => s.token === token && s.deviceId === deviceId)
  if (!session) return res.json({ ok: false, msg: '会话失效，请重新登录' })
  const acc = db.accounts.find(a => a.id === session.accountId)
  const userPayLogs = db.pay_logs.filter(l => l.accountId === acc.id).sort((a, b) => b.timestamp - a.timestamp)
  res.json({ ok: true, account: acc, payLogs: userPayLogs })
})

// 用户支付，写入支付流水
app.post('/api/user/pay', (req, res) => {
  const { token, deviceId, amount, receiverName, note } = req.body
  const db = loadDB()
  const session = db.sessions.find(s => s.token === token && s.deviceId === deviceId)
  if (!session) return res.json({ ok: false, msg: '会话失效' })
  const acc = db.accounts.find(a => a.id === session.accountId)
  const payAmt = Number(amount)
  if (payAmt > acc.balance) return res.json({ ok: false, msg: '余额不足' })
  acc.balance = Number((acc.balance - payAmt).toFixed(2))
  db.pay_logs.push({
    logId: uuidv4(),
    accountId: acc.id,
    username: acc.username,
    amount: payAmt,
    receiverName,
    note,
    time: new Date().toLocaleString(),
    timestamp: Date.now()
  })
  saveDB(db)
  res.json({ ok: true, balance: acc.balance })
})

app.listen(PORT, () => {
  console.log(`服务启动，端口：${PORT}`)
})