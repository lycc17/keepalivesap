# ☁️ SAP Cloud Platform Keep-Alive & Monitor

一个运行在 **Cloudflare Workers** 上的自动化工具，专为 SAP Cloud Platform (Cloud Foundry) 环境设计。它可以实时监控您的应用状态，并在应用离线（休眠）时自动调用 SAP API 进行重启，同时通过 Telegram 发送通知。

![Cloudflare Workers](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Workers-orange?logo=cloudflare)
![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ 核心功能

*   **🔍 智能监控**: 定时检查应用 URL 连通性 (HTTP 200)。
*   **♻️ 自动保活**: 一旦发现应用离线，自动登录 SAP CF API (支持 US10/AP21/EU10 区域) 并执行重启操作。
*   **📱 Telegram 通知**: 推送精美的报警消息（离线提醒、重启进度、重启结果）。
*   **📊 状态仪表盘**: 提供一个可视化的 Web 页面，实时查看所有账号下应用的运行状态。
*   **🔐 安全配置**: 支持通过 Cloudflare 环境变量注入账号信息，无需将密码硬编码在代码中。

## 🚀 部署指南

### 1. 创建 Worker
1.  登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2.  进入 **Workers & Pages** -> **Create application** -> **Create Worker**。
3.  命名为 `sap-monitor` (或其他名称)，点击 **Deploy**。
4.  点击 **Edit code**，将本项目提供的 `worker.js` 代码完整粘贴进去，点击 **Save and deploy**。

### 2. 配置环境变量 (关键步骤)
为了安全起见，建议通过环境变量配置账号信息。
进入 Worker 的 **Settings** -> **Variables** -> **Environment Variables**，添加以下变量：

| 变量名 | 必填 | 说明 |
| :--- | :---: | :--- |
| `SAP_CONFIG` | ✅ | **核心配置**。包含账号密码和应用列表的 JSON 字符串 (格式见下方)。 |
| `CHAT_ID` | ❌ | Telegram 用户 ID (用于接收通知)。 |
| `BOT_TOKEN` | ❌ | Telegram 机器人 Token。 |

#### `SAP_CONFIG` 填写格式
这是一个 JSON 数组字符串。请将以下内容修改为您的实际信息，压缩成一行（可选）后填入变量值中：

```json
[
  {
    "email": "user1@example.com",
    "password": "your_password_here",
    "apps": [
      {
        "name": "my-app-01",
        "url": "https://my-app-01.cfapps.us10-001.hana.ondemand.com"
      },
      {
        "name": "my-backend",
        "url": "https://my-backend.cfapps.ap21.hana.ondemand.com"
      }
    ]
  },
  {
    "email": "user2@example.com",
    "password": "another_password",
    "apps": [
      {
        "name": "demo-app",
        "url": "https://demo-app.cfapps.eu10.hana.ondemand.com"
      }
    ]
  }
]
```
> **注意**: `name` 必须与 SAP BTP 控制台中的应用名称完全一致，脚本依靠此名称进行重启。

### 3. 设置定时任务 (Cron Triggers)
为了实现自动保活，需要配置定时触发器。
1.  进入 **Settings** -> **Triggers**。
2.  点击 **Add Cron Trigger**。
3.  建议设置频率为 **每 30 分钟**。
    *   Cron 表达式: `*/30 * * * *`

## 🖥️ 使用说明

### 查看状态面板
部署完成后，直接访问 Worker 的 URL (例如 `https://sap-monitor.your-name.workers.dev`)，即可看到状态仪表盘：
<img width="1209" height="938" alt="f04f3481-ddf4-4e9e-8d0e-ff08d14a0039" src="https://github.com/user-attachments/assets/e43ae9ed-a643-4fb5-ba76-ae7db1ac3418" />

*   **绿色卡片**: 应用运行正常 (HTTP 200)。
*   **红色卡片**: 应用异常，脚本会在下一次 Cron 周期尝试重启。
*   点击页面上的 **"刷新状态"** 按钮可重新加载数据。

### 手动触发检测
您可以访问 `https://sap-monitor.your-name.workers.dev/start` 手动触发一次后台检测与保活任务（通常用于测试配置是否正确）。

## 🌍 支持的区域
脚本内置了正则表达式，根据 URL 自动识别以下区域并调用对应的 API：
*   **US10** (美国): `us10-001.hana.ondemand.com`
*   **AP21** (新加坡): `ap21.hana.ondemand.com`
*   **EU10** (欧洲): `eu10.hana.ondemand.com`

*如果您的应用位于其他区域，请修改代码中的 `REGIONS` 常量。*

## ⚠️ 免责声明
*   本工具仅供学习和辅助管理使用。
*   请勿将敏感的账号密码泄露给他人。
*   SAP Cloud Platform 的 API 策略可能会随时调整，作者不保证脚本长期有效。

---
**License**: MIT
