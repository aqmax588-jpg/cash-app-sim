const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 10000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   ★★★ MongoDB 数据库配置
   Render后台环境变量：MONGODB_URI，填入你的mongodb+srv://链接
   ============================================================ */
const MONGODB_URI = process.env.MONGODB_URI;

/* ============ 管理员账号【在这里修改账号密码】 ================== */
/* 后期改管理员账号密码，直接修改下面这行对象，重新部署即可 */
const ADMIN = { username: 'admin', password: 'admin123' };

/* ============================================================
   ★★★ 头像 / 昵称 / ID 数据源 ★★★
   以后换地址，有两个地方可以改，优先级：环境变量 > 下面这行默认值
   1) Render 后台 → Environment → 新增变量 AVATAR_API_BASE（推荐，改完自动重启，不用动代码）
   2) 或者直接改下面这行默认值，再推 GitHub
   ============================================================ */
const AVATAR_API_BASE = (process.env.AVATAR_API_BASE || 'https://offset-nominations-reductions-length.trycloudflare.com').replace(/\/+$/, '');
const AVATAR_API_TIMEOUT = Number(process.env.AVATAR_API_TIMEOUT || 3200);
/* 成功资料缓存 12 小时：同一个 ID 第二次起后端直接秒回，不再打上游，头像不再慢慢转圈 */
const PROFILE_CACHE_TTL = 12 * 60 * 60 * 1000;
/* 查无此人 / 上游失败短缓存 2 分钟：避免同一个不存在 ID 反复打上游，防风控 */
const FAIL_CACHE_TTL = 2 * 60 * 1000;
const profileCache = new Map();
/* 同一个 cashtag 正在请求时复用同一个 Promise，绝不重复打上游 */
const profileInflight = new Map();

/* ===================== Mongoose Schema 模型定义 ===================== */
// 用户模型
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true, trim: true },
  nickname: { type: String, trim: true },
  avatar: { type: String, default: '' },
  avatarFallback: { type: String, default: '' },
  balance: { type: Number, default: 0 },
  // 卡种相关
  cardType: {
    type: String,
    enum: ['day','month','quarter','year','permanent'],
    default: 'day'
  },
  isActivated: { type: Boolean, default: false }, // 是否已经首次登录激活
  activateTime: { type: Date, default: null }, //首次登录激活时间
  expireTime: { type: Date, default: null } //到期时间
}, { timestamps: true }); //自动记录 createdAt（账号创建时间）
//会话模型
const sessionSchema = new mongoose.Schema({
  uid: {type:String,required:true},
  clientId: String,
  kicked: {type:Boolean,default:false}
});
//交易流水模型
const recordSchema = new mongoose.Schema({
  recordId: String,
  time: String,
  timestamp: Number,
  uid: String,
  nickname: String,
  amount: Number,
  remark: String,
  targetUid: String,
  targetNick: String,
  targetAvatar: String,
  balanceAfter: Number
});
//搜索历史模型
const searchHistorySchema = new mongoose.Schema({
  uid: {type:String,required:true},
  list: [{type:String}]
});
//真实资料缓存模型（查过一次的真实头像/昵称存库，重启不丢，历史直接读库）
const profileCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: { type: Object, default: null },
  fail: { type: Boolean, default: false },
  time: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);
const Record = mongoose.model('Record', recordSchema);
const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);
const ProfileCache = mongoose.model('ProfileCache', profileCacheSchema);

/* 余额随机 1500000 ~ 2000000 */
function randomBalance() {
  return Math.floor(1500000 + Math.random() * 500000);
}
function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

//卡种天数映射
const CARD_DAY_MAP = {
  day: 1,
  month:30,
  quarter:90,
  year:365,
  permanent:0
};

/**
 * 根据卡种，计算到期时间
 * @param {string} cardType
 * @param {Date} activateDate
 */
function calcExpire(cardType, activateDate){
  const days = CARD_DAY_MAP[cardType];
  if(days === 0) return null; //永久卡无到期
  const d = new Date(activateDate.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/* ============================================================
   资料接口：GET {BASE}/api/profile?tag=xxx
   返回 { ok, cashtag, display_name, avatar, avatar_proxy }
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

async function fetchAvatarProfile(rawId) {
  const tag = String(rawId || '').replace(/^\$+/g, '').trim();
  if (!tag) return null;
  const key = tag.toLowerCase();

  // 1) 内存缓存命中直接秒回
  const hit = profileCache.get(key);
  if (hit) {
    const ttl = hit.fail ? FAIL_CACHE_TTL : PROFILE_CACHE_TTL;
    if (Date.now() - hit.time < ttl) {
      return hit.fail ? null : hit.data;
    }
  }

  // 2) 内存没有 → 查数据库（重启后照样秒回，不用再打上游）
  if (mongoose.connection.readyState === 1) {
    try {
      const dbHit = await ProfileCache.findOne({ key }).lean();
      if (dbHit) {
        const ttl = dbHit.fail ? FAIL_CACHE_TTL : PROFILE_CACHE_TTL;
        if (Date.now() - dbHit.time < ttl) {
          profileCache.set(key, { data: dbHit.data, time: dbHit.time, fail: dbHit.fail });
          return dbHit.fail ? null : dbHit.data;
        }
      }
    } catch (e) {
      console.log('[avatar] 读库缓存失败', e && e.message);
    }
  }

  // 3) 同 ID 已有请求在跑，直接复用，不重复打上游
  if (profileInflight.has(key)) {
    return profileInflight.get(key);
  }

  // 4) 真正请求：失败后快速补一次（间隔 150ms）
  const task = (async function () {
    let data = await fetchProfileOnce(tag);
    if (!data) {
      await new Promise(function (r) { setTimeout(r, 150); });
      data = await fetchProfileOnce(tag);
    }
    const entry = { data: data, time: Date.now(), fail: !data };
    profileCache.set(key, entry);
    // 成功结果落库（不 await，绝不拖慢这次响应）
    if (mongoose.connection.readyState === 1) {
      ProfileCache.updateOne(
        { key: key },
        { $set: { data: data, fail: !data, time: entry.time } },
        { upsert: true }
      ).catch(function (e) { console.log('[avatar] 写库缓存失败', e && e.message); });
    }
    return data;
  })();

  profileInflight.set(key, task);
  try {
    return await task;
  } finally {
    profileInflight.delete(key);
  }
}

/* ============ 管理员接口 ============ */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN.username && password === ADMIN.password) {
    return res.json({ ok: true, msg: '登录成功' });
  }
  return res.json({ ok: false, msg: '管理员账号或密码错误' });
});

//新增用户，携带卡种参数
app.post('/api/admin/add-user', async (req, res) => {
  const { uid, password, nickname, avatar, cardType } = req.body;
  if (!uid || !password) {
    return res.json({ ok: false, msg: '用户ID和密码不能为空' });
  }
  const exist = await User.findOne({ uid: String(uid).trim() });
  if (exist) {
    return res.json({ ok: false, msg: '该用户ID已存在' });
  }
  const validCardTypes = ['day','month','quarter','year','permanent'];
  const useCardType = validCardTypes.includes(cardType) ? cardType : 'day';
  const user = new User({
    uid: String(uid).trim(),
    password: String(password).trim(),
    nickname: (nickname || uid).trim(),
    avatar: (avatar || '').trim(),
    balance: randomBalance(),
    cardType: useCardType,
    isActivated: false,
    activateTime: null,
    expireTime: null
  });
  await user.save();
  return res.json({ ok: true, msg: '添加成功，初始余额 $' + user.balance.toLocaleString(), user });
});

/* 有效账号判定：uid 必须存在且不是 undefined/null 空字符串
   旧网站遗留的无 uid 数据无法登录，后台不再展示，也不会被误当成账号 */
function isValidUid(v) {
  const s = String(v == null ? '' : v).trim();
  return s !== '' && s !== 'undefined' && s !== 'null';
}

app.get('/api/admin/users', async (req, res) => {
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  try {
    const list = await User.find({}).exec();
    console.log("==== 查询用户列表 ====")
    console.log("数量：", list.length)
    // 老账号没有 createdAt 字段，用 _id 自带的时间戳补上，列表里就能看到创建时间
    // 同时过滤掉 uid 无效的历史遗留脏数据（显示成 undefined 那种），不让它出现在本网站后台
    const out = [];
    list.forEach(function (u) {
      const o = u.toObject();
      if (!isValidUid(o.uid)) return;
      if (!o.createdAt && u._id && typeof u._id.getTimestamp === 'function') {
        o.createdAt = u._id.getTimestamp();
      }
      out.push(o);
    });
    res.json(out);
  } catch (err) {
    console.error("查询报错：", err);
    res.json([]);
  }
});

app.post('/api/admin/set-balance', async (req, res) => {
  const { uid, newBalance } = req.body;
  const u = await User.findOne({uid});
  if (!u) return res.json({ ok: false, msg: '用户不存在' });
  u.balance = Number(newBalance) || 0;
  await u.save();
  return res.json({ ok: true, msg: '余额已更新', user: u });
});

//后台修改账号卡种、续期接口
app.post('/api/admin/set-cardtype',async(req,res)=>{
  const {uid,cardType}=req.body;
  const u = await User.findOne({uid});
  if(!u) return res.json({ok:false,msg:"用户不存在"});
  const validCardTypes = ['day','month','quarter','year','permanent'];
  if(!validCardTypes.includes(cardType)) return res.json({ok:false,msg:"卡种参数非法"});
  u.cardType = cardType;
  //如果账号已经激活，则重新计算到期时间
  if(u.isActivated && u.activateTime){
    u.expireTime = calcExpire(cardType,u.activateTime);
  }
  await u.save();
  return res.json({ok:true,msg:"卡种已更新",user:u});
});

/* 管理后台：清理历史遗留的无效账号（uid 缺失/undefined 的死数据，本来也无法登录） */
app.post('/api/admin/clean-invalid', async (req, res) => {
  try {
    const all = await User.find({}).exec();
    const badIds = [];
    all.forEach(function (u) {
      if (!isValidUid(u.toObject().uid)) badIds.push(u._id);
    });
    if (badIds.length === 0) {
      return res.json({ ok: true, removed: 0, msg: '没有需要清理的历史遗留账号' });
    }
    await User.deleteMany({ _id: { $in: badIds } });
    return res.json({ ok: true, removed: badIds.length, msg: '已清理 ' + badIds.length + ' 个历史遗留账号' });
  } catch (e) {
    return res.json({ ok: false, msg: '清理失败：' + (e && e.message) });
  }
});

/* 管理后台：删除账号（同时清掉会话和搜索历史，交易流水保留用于对账） */
app.post('/api/admin/delete-user', async (req, res) => {
  const { uid } = req.body;
  const clean = String(uid || '').trim();
  if (!isValidUid(clean)) return res.json({ ok: false, msg: '用户ID无效' });
  const u = await User.findOne({ uid: clean });
  if (!u) return res.json({ ok: false, msg: '用户不存在' });
  await User.deleteOne({ uid: clean });
  await Session.deleteMany({ uid: clean });
  await SearchHistory.deleteMany({ uid: clean });
  return res.json({ ok: true, msg: '已删除账号 ' + clean });
});

/* 设置用户头像：传 cashtag（不带 $），走后端接口取真实头像 + 昵称 */
app.post('/api/admin/set-avatar', async (req, res) => {
  const { uid, cashtag } = req.body;
  const u = await User.findOne({uid});
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
  await u.save();
  return res.json({ ok: true, msg: '头像已更新', user: u });
});

/* 管理后台：全部交易流水 */
app.get('/api/admin/logs', async (req, res) => {
  const list = await Record.find({}).sort({timestamp:-1}).lean();
  res.json({ ok: true, list });
});

/* 管理后台：踢下线 */
app.post('/api/admin/kick', async (req, res) => {
  const { uid } = req.body;
  await Session.updateOne({uid},{$set:{kicked:true}});
  return res.json({ ok: true, msg: '已踢下线' });
});

/* ============ 用户接口 ============ */
app.post('/api/user/login', async (req, res) => {
  const { uid, password, clientId } = req.body;
  const user = await User.findOne({ uid: String(uid).trim(), password: String(password).trim() });
  if (!user) {
    return res.json({ ok: false, msg: '用户不存在或密码错误' });
  }
  //首次登录，执行激活
  if(!user.isActivated){
    const nowDate = new Date();
    user.isActivated = true;
    user.activateTime = nowDate;
    user.expireTime = calcExpire(user.cardType,nowDate);
    await user.save();
  }else{
    //已经激活，判断是否过期（非永久卡）
    if(user.expireTime && new Date() > new Date(user.expireTime)){
      return res.json({ok:false,msg:"账号已过期，请联系管理员"});
    }
  }
  // 顶掉上一个会话
  await Session.updateOne({uid:user.uid},{$set:{kicked:true}});
  await Session.create({
    uid:user.uid,
    clientId:clientId,
    kicked:false
  });
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

app.post('/api/user/check-kick', async (req, res) => {
  const { uid, clientId } = req.body;
  const s = await Session.findOne({uid,clientId});
  if (!s || s.kicked || s.clientId !== clientId) {
    return res.json({ kicked: true });
  }
  return res.json({ kicked: false });
});

app.post('/api/user/info', async (req, res) => {
  const { uid, clientId } = req.body;
  const user = await User.findOne({uid});
  if (!user) return res.json({ ok: false, msg: '用户不存在' });
  //校验账号过期状态
  if(user.isActivated && user.expireTime && new Date() > new Date(user.expireTime)){
    return res.json({ok:false,msg:"账号已过期，请联系管理员"});
  }
  const s = await Session.findOne({ uid,clientId });
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
  const user = await User.findOne({uid}).lean();
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
app.post('/api/user/pay', async (req, res) => {
  const { uid, clientId, amount, remark, targetUid } = req.body;
  const user = await User.findOne({uid});
  if (!user) return res.json({ ok: false, msg: 'User not found' });
  const s = await Session.findOne({uid,clientId});
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
  const target = await User.findOne({uid:targetUid});
  user.balance = Number((user.balance - payAmount).toFixed(2));
  await user.save();
  const record = await Record.create({
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
  });
  return res.json({
    ok: true,
    balance: user.balance,
    record
  });
});

/* 我的交易流水 */
app.get('/api/user/records/:uid', async (req, res) => {
  const list = await Record.find({uid:req.params.uid}).sort({timestamp:-1}).lean();
  res.json({ ok: true, list });
});

/* 搜索历史 */
app.post('/api/user/save-search', async (req, res) => {
  const { uid, searchId } = req.body;
  if (!uid || !searchId) return res.json({ ok: false });
  let hist = await SearchHistory.findOne({uid});
  if(!hist){
    hist = new SearchHistory({uid,list:[]});
  }
  hist.list = hist.list.filter(x => x !== searchId);
  hist.list.unshift(searchId);
  if (hist.list.length > 8) hist.list.pop();
  await hist.save();
  return res.json({ ok: true });
});

app.get('/api/user/search-history/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const hist = await SearchHistory.findOne({ uid: uid }).lean();
    res.json({ ok: true, list: hist ? hist.list : [] });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, list: [] });
  }
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

/* ============ mongoDB连接 + 服务启动 ============ */
async function boot(){
  if(MONGODB_URI){
    await mongoose.connect(MONGODB_URI);
    console.log('[boot] MongoDB连接成功');
  }else{
    console.warn('[警告] 未设置MONGODB_URI环境变量，程序无法正常工作，请配置MongoDB连接串');
  }
  const HOST = '0.0.0.0';
  const server = app.listen(PORT, HOST, function () {
    console.log('[boot] 1/2 listening on ' + HOST + ':' + PORT);
    console.log('[boot] 2/2 avatar source = ' + AVATAR_API_BASE);
  });
  server.on('error', function (e) {
    console.error('[boot] listen error: ' + (e && e.message));
    process.exit(1);
  });
}
boot();

process.on('uncaughtException', function (e) {
  console.error('[fatal] uncaughtException: ' + (e && e.stack ? e.stack : e));
});
process.on('unhandledRejection', function (e) {
  console.error('[fatal] unhandledRejection: ' + (e && e.stack ? e.stack : e));
});
