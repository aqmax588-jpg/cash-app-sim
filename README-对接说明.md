# 对接说明（改完直接推 GitHub，Render 自动更新）

## 这套系统现在靠什么取真实头像
```
浏览器（手机/电脑）
      ↓  /api/user/lookup/xxx（你 Render 上的 Node 服务）
server.js（Render）
      ↓  带着完整地址请求
https://你的隧道地址/api/profile?tag=xxx（你家里的电脑）
      ↓  走美国代理
cash.app 公开页面 → 抓 ID / 昵称 / 头像
      ↓
https://你的隧道地址/api/img?tag=xxx（图片中转，手机端直接能显示）
```

## 以后地址变了，只改一个地方

### 推荐做法：Render 后台改环境变量（不用动代码）
1. 登录 Render → 找到你的 web service → 左侧 **Environment**
2. 新增一条：
   - Key：`AVATAR_API_BASE`
   - Value：新的隧道地址，例如 `https://xxxx-xxxx.trycloudflare.com`
   （不用带结尾斜杠）
3. 保存，Render 会自动重新部署，1 分钟后生效

### 备用做法：直接改代码
打开 `server.js`，第 16 行左右：
```js
const AVATAR_API_BASE = (process.env.AVATAR_API_BASE || 'https://你的隧道地址').replace(/\/+$/, '');
```
把引号里的地址换成新的，保存，推 GitHub。

> 环境变量优先级高于代码里的默认值，两个都改了也不冲突。

## 部署完先做这一步自检
浏览器打开：
```
https://你的-render-域名/api/source-check
```
返回 `"ok": true` 且能看到 `nickname` / `avatar`，说明整条链路通了。
如果 `"ok": false`，说明家里的电脑没开机、隧道没跑、或者地址过期了。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 搜索一直显示首字母、没头像 | 家里电脑/tunnel 没跑，或地址过期 | 双击「一键启动.bat」拿新地址，按上面步骤更新 |
| 有昵称但头像空白 | 图片中转失败 | 先访问 `https://隧道/api/img?tag=xxx` 看是否有图 |
| 搜索要等十几秒 | 该 ID 第一次查、家里电脑冷启动 | 正常，查过的会缓存在 Render 内存 10 分钟 |
| 随便输入都有结果但没头像 | 走的是兜底逻辑 | 说明接口没通，按第一条排查 |

## 代码改动清单
- `server.js`：重写头像获取逻辑（只调 `/api/profile`，不再瞎猜路径）；超时 15 秒；内存缓存 10 分钟；失败重试一次；`avatar` 统一转成完整中转 URL；新增 `/api/source-check` 自检；`/api/admin/set-avatar` 改用新接口（同时会同步真实昵称）
- `public/script.js`：头像加载失败时自动退回原图（`avatarFallback`），再失败才隐藏
- 其他文件（index.html / cash.html / admin.html / style.css）未改动
