# DSH RPC 契约（实测确认，勿改）

> dsh-mobile 通过 DSH 的 HTTP /api 接口通信。以下为实测契约（2026-08-25 验证）。

## 通用信封

```
json
// 请求
{ "type": "client-request", "rpcId": "uuid", "method": "session.list", "payload": {...} }
// 成功
{ "type": "server-response", "rpcId": "...", "result": { "ok": true, "value": {...} } }
// 失败
{ "type": "server-response", "rpcId": "...", "result": { "ok": false, "error": { "code": "...", "message": "..." } } }
```

- URL：POST /api/<命名空间>.<方法>（点号，非斜杠）
- payload 是直接业务参数（不是 {args:{...}} 包裹）

## 端点

| 方法 | payload | 返回 value |
|---|---|---|
| session.list | {} | {items:[{sessionId,updatedAt,running,blank,agentPreset,cwd,projections}]} |
| session.history | {sessionId, maxMessages?, beforeSeq?} | {events:[{event:{type,seq,time,data}}]} |
| session.prompt | {sessionId, mode, content, clientTimeZone?} | {accepted:true} |
| session.rename / cancel / fork / create / search / selectModel / attachment | 见 schema | 视方法而定 |
| POST `/api/respond` | `client-response` 信封（不是普通 RPC） | `{accepted:true}` 或拒绝原因 |
| workspace.list / goal.list / jobs.list | {} | 列表 |

- session.create payload：{workspaceId|cwd, sessionId?, agentPreset?, reuseWorkspaceBlank?}
- session.attachment：{sessionId, attachmentId} → {attachment, data}（data 为原图 base64）
- session.prompt.mode："queue"（排队）| "steer"（打断转向）

## 事件流（/api/events.mux，WebSocket）

- HTTP GET 返回 426，必须 WebSocket 升级（网关代理透传）。
- 帧：{type:'server-request', rpcId, method, payload}
- payload.type='session/subscribed'：订阅确认（{sessionId, lastSeq}）
- payload.type='session/event'：{sessionId, event:{type,seq,time,data}}
- payload.type='question/requested'：`{sessionId,questions}`；必须保留外层 `rpcId`
- payload.type='question/resolved'：`{sessionId,questionRpcId,outcome}`
  - **sessionId 在 payload 层，不在 event 内**（串线修复的根因）
- 事件类型：user/message、assistant/message、assistant/chunk（流式增量）、tool/call、tool/result、turn/start|end、step/start|end、agent/inbox/spliced

## 关键数据形状

- 会话标题在 projections.values.title（不在顶层）
- 消息 content 块：text、reasoning、tool-call、tool-result、image
- image 块：{type:'image', attachment:{attachmentId, mediaType, width, height, bytes, name}}
- 回答问题：`POST /api/respond`，body=`{type:'client-response',rpcId,result:{ok:true,value:{sessionId,answer:{answers:[{id,selected,custom?}]}}}}`
- 图片上限（imageLimits）：maxImageBytes≈3.5MB、maxImageDimension=2000、maxImagePixels=4000万

## 认证端点（不走 RPC 信封）

| 端点 | 说明 |
|---|---|
| POST /api/auth/device-bind | 一次性令牌 → 签发设备 Cookie（30 天）；每次绑定前重载 `tokens.json`，CLI 新令牌无需重启网关 |
| GET /api/auth/me | 校验当前设备 |
| POST /api/auth/unbind | 解绑 |
