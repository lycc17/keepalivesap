// ==========================================
// 1. 多账号配置区域 (可直接修改代码，也可使用环境变量)
// ==========================================
// 优先级说明: 
// 1. 如果 Cloudflare 后台设置了环境变量 SAP_CONFIG，则优先使用环境变量。
// 2. 如果没有环境变量，则使用下方代码中的 defaultAccounts。

let ACCOUNTS = [];

const defaultAccounts = [
  {
    "email": "***@***.com",
    "password": "******",
    "apps": [
      { name: "***", url: "https://***.cfapps.ap21.hana.ondemand.com" },
      { name: "***", url: "https://***.cfapps.us10-001.hana.ondemand.com" }
    ]
  },
  {
    "email": "***1@***.com",
    "password": "******",
    "apps": [
      { name: "***", url: "https://***.cfapps.us10-001.hana.ondemand.com" },
      { name: "***", url: "https://***.cfapps.ap21.hana.ondemand.com" }
    ]
  }
];

// ==========================================
// 2. 全局配置 (Telegram)
// ==========================================
let CHAT_ID = "6386912155";    
let BOT_TOKEN = "7559161898:AAHgsijIHF7ws1jUA_hitApdm0xIpi72PuM";

// ==========================================
// 3. 系统常量 (无需更改)
// ==========================================
const REGIONS = {
  US: {
    CF_API: "https://api.cf.us10-001.hana.ondemand.com",
    UAA_URL: "https://uaa.cf.us10-001.hana.ondemand.com",
    DOMAIN_PATTERN: /\.us10(-001)?\.hana\.ondemand\.com$/
  },
  AP: {
    CF_API: "https://api.cf.ap21.hana.ondemand.com",
    UAA_URL: "https://uaa.cf.ap21.hana.ondemand.com",
    DOMAIN_PATTERN: /\.ap21\.hana\.ondemand\.com$/
  },
  EU: {
    CF_API: "https://api.cf.eu10.hana.ondemand.com",
    UAA_URL: "https://uaa.cf.eu10.hana.ondemand.com",
    DOMAIN_PATTERN: /\.eu10\.hana\.ondemand\.com$/
  }
};

// ==========================================
// 4. 工具函数
// ==========================================
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json" } });

// 邮箱脱敏显示 (UI用)
function maskEmail(email) {
  if (!email) return "Unknown";
  try {
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const visibleLen = name.length > 3 ? 3 : 1;
    return `${name.substring(0, visibleLen)}***@${parts[1]}`;
  } catch { return email; }
}

// 上海时间格式化
function formatShanghaiTime(date) {
  const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
  const shanghaiTime = new Date(utcTime + (8 * 60 * 60 * 1000));
  return shanghaiTime.getFullYear() + '-' + 
         String(shanghaiTime.getMonth() + 1).padStart(2, '0') + '-' + 
         String(shanghaiTime.getDate()).padStart(2, '0') + ' ' +
         String(shanghaiTime.getHours()).padStart(2, '0') + ':' +
         String(shanghaiTime.getMinutes()).padStart(2, '0');
}

// 区域名称映射
function getRegionName(code) {
  if (code === 'US') return '美国';
  if (code === 'AP') return '新加坡';
  if (code === 'EU') return '欧洲';
  return '未知区域';
}

// Telegram 发送函数
async function sendTelegramMessage(message) {
  if (!CHAT_ID || !BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "Markdown" })
    });
  } catch (e) { console.error("TG Send Error:", e); }
}

// ==========================================
// 5. 核心业务逻辑
// ==========================================
function detectRegionFromUrl(url) {
  for (const [code, cfg] of Object.entries(REGIONS)) {
    if (cfg.DOMAIN_PATTERN.test(url)) return code;
  }
  return null;
}

async function cfGET(url, token) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`CF GET ${res.status}`);
  return await res.json();
}

async function cfPOST(url, token, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : null
  });
  if (!res.ok) throw new Error(`CF POST ${res.status}`);
  return res.text().then(t => t ? JSON.parse(t) : {});
}

async function getUAAToken(email, password, uaaUrl) {
  const params = new URLSearchParams({
    "grant_type": "password",
    "username": email,
    "password": password,
    "response_type": "token"
  });
  const res = await fetch(`${uaaUrl}/oauth/token`, {
    method: "POST",
    headers: { authorization: "Basic " + btoa("cf:"), "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!res.ok) throw new Error(`Auth Failed: ${res.status}`);
  return (await res.json()).access_token;
}

// --- 核心流程 ---
async function ensureAppRunning(appConfig, accountEmail, accountPassword, reason) {
  const {url, name, region} = appConfig;
  
  if (await checkAppUrl(url)) {
    return {app: name, email: accountEmail, status: "healthy", url: url};
  }
  
  // 离线提醒
  const timeStr = formatShanghaiTime(new Date());
  const offlineMsg = `⚠️ *SAP应用离线提醒*\n\n应用名称: ${name}\n应用URL: ${url}\n时间: ${timeStr}\n\n正在尝试重启应用...\n请检查一下`;
  
  await sendTelegramMessage(offlineMsg);
  console.log(`[Restarting] ${name} is down.`);

  try {
    const detectedRegion = region || detectRegionFromUrl(url);
    if (!detectedRegion) throw new Error("Unknown Region");
    const cfg = REGIONS[detectedRegion];
    
    const token = await getUAAToken(accountEmail, accountPassword, cfg.UAA_URL);
    const appsRes = await cfGET(`${cfg.CF_API}/v3/apps?names=${encodeURIComponent(name)}`, token);
    const appGuid = appsRes.resources?.[0]?.guid;
    
    if (appGuid) {
      const appState = (await cfGET(`${cfg.CF_API}/v3/apps/${appGuid}`, token)).state;
      if (appState !== "STARTED") {
        await cfPOST(`${cfg.CF_API}/v3/apps/${appGuid}/actions/start`, token);
      }
    }
  } catch (error) {
    await sendTelegramMessage(`❌ *重启指令发送失败*\n应用: ${name}\n错误: ${error.message}`);
    throw error;
  }
  
  await sleep(15000); 
  
  // 成功/失败通知
  const finishTimeStr = formatShanghaiTime(new Date());
  
  if (await checkAppUrl(url)) {
    const successMsg = `✅ *SAP应用重启成功*\n\n应用名称: ${name}\n应用URL: ${url}\n时间: ${finishTimeStr}`;
    await sendTelegramMessage(successMsg);
    return {app: name, email: accountEmail, status: "started", url: url};
  } else {
    const failMsg = `❌ *SAP应用重启失败*\n\n应用名称: ${name}\n应用URL: ${url}\n时间: ${finishTimeStr}\n请手动检查`;
    await sendTelegramMessage(failMsg);
    return {app: name, email: accountEmail, status: "failed", url: url};
  }
}

async function checkAppUrl(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return res.status === 200;
  } catch { return false; }
}

async function monitorAllApps(reason) {
  const results = [];
  for (const acc of ACCOUNTS) {
    if (!acc.apps) continue;
    for (const app of acc.apps) {
      try {
        results.push(await ensureAppRunning(app, acc.email, acc.password, reason));
      } catch (e) {
        results.push({app: app.name, status: "error", msg: e.message});
      }
      await sleep(1000);
    }
  }
  return results;
}

// ==========================================
// 6. UI 生成 (带 Logo 的美化版)
// ==========================================
function generateStatusPage(flatApps) {
  const now = formatShanghaiTime(new Date());
  
  // 生成内嵌的 SVG Logo (蓝色背景 + 白色打钩)
  const faviconSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23667eea'/%3E%3Cpath d='M25 55 L40 70 L75 35' fill='none' stroke='white' stroke-width='10' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

  const statusCards = flatApps.map(app => {
    const isUp = app.healthy;
    const regionCode = detectRegionFromUrl(app.url) || 'Unknown';
    const regionName = getRegionName(regionCode);
    const maskedEmail = maskEmail(app.email);
    
    const cardClass = isUp ? 'card-success' : 'card-danger';
    const statusText = isUp ? '运行中' : '已停止';
    const badgeClass = isUp ? 'badge-success' : 'badge-danger';

    return `
      <div class="card ${cardClass}">
        <div class="card-header">
          <div class="app-name">${app.name}</div>
          <div class="status-badge ${badgeClass}">${statusText}</div>
        </div>
        
        <div class="card-body">
          <div class="info-row">
            <span class="info-label">账号:</span> ${maskedEmail}
          </div>
          <div class="info-row">
            <span class="info-label">区域:</span> ${regionName}
          </div>
          <div class="info-row url-row">
            <span class="info-label">URL:</span> 
            <a href="${app.url}" target="_blank">${app.url}</a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SAP Cloud 应用监控</title>
  <link rel="icon" type="image/svg+xml" href="${faviconSvg}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; color: #333; }
    
    /* 顶部 Banner */
    .header-banner {
      background-color: #6a7dfe;
      background-image: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; padding: 50px 20px; text-align: center; margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .header-banner h1 { margin: 0; font-size: 2.5rem; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 15px; }
    .header-banner p { margin-top: 10px; opacity: 0.9; font-size: 1.1rem; }

    /* 容器 */
    .container { max-width: 1000px; margin: 0 auto; padding: 0 20px 40px; }

    /* 按钮 */
    .btn-refresh {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; border: none; padding: 12px 36px; font-size: 16px; border-radius: 6px;
      cursor: pointer; display: block; margin: 0 auto 40px;
      box-shadow: 0 4px 10px rgba(102, 126, 234, 0.4); transition: transform 0.2s;
    }
    .btn-refresh:hover { transform: translateY(-2px); }

    /* 网格 */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }

    /* 卡片 */
    .card { border-radius: 12px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: transform 0.2s; }
    .card:hover { transform: translateY(-3px); }

    .card-success { background-color: #e8f5e9; border: 1px solid #c8e6c9; }
    .card-success .app-name { color: #2e7d32; }
    .card-success .info-label { color: #4caf50; }

    .card-danger { background-color: #ffebee; border: 1px solid #ffcdd2; }
    .card-danger .app-name { color: #c62828; }
    .card-danger .info-label { color: #e57373; }

    .card-header { padding: 20px 20px 10px; display: flex; justify-content: space-between; align-items: center; }
    .app-name { font-size: 1.5rem; font-weight: bold; }

    .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 0.9rem; font-weight: bold; }
    .badge-success { background-color: #a5d6a7; color: #1b5e20; opacity: 0.8; }
    .badge-danger { background-color: #ef9a9a; color: #b71c1c; opacity: 0.8; }

    .card-body { padding: 10px 20px 25px; text-align: center; font-size: 0.95rem; color: #555; }
    .info-row { margin: 8px 0; }
    .info-label { font-weight: bold; margin-right: 5px; }
    .url-row a { color: #1976d2; text-decoration: none; word-break: break-all; }
    .url-row a:hover { text-decoration: underline; }

    .footer { text-align: center; margin-top: 50px; color: #999; font-size: 0.85rem; }
    
    /* Logo in Header (Optional) */
    .header-logo { height: 40px; width: 40px; background: rgba(255,255,255,0.2); border-radius: 8px; padding: 5px; }
  </style>
</head>
<body>
  <div class="header-banner">
    <h1>
      <!-- 内嵌 Logo 显示在标题旁 -->
      <img src="${faviconSvg}" class="header-logo" alt="Logo">
      SAP Cloud 应用监控
    </h1>
    <p>实时监控应用状态，确保服务持续可用</p>
  </div>
  <div class="container">
    <button class="btn-refresh" onclick="location.reload()">刷新状态</button>
    <div class="grid">${statusCards}</div>
    <div class="footer">最后更新: ${now} (北京时间)</div>
  </div>
</body>
</html>
  `;
}

// ==========================================
// 7. 入口函数
// ==========================================
function initConfig(env) {
  CHAT_ID = env.CHAT_ID || CHAT_ID;
  BOT_TOKEN = env.BOT_TOKEN || BOT_TOKEN;
  
  if (env.SAP_CONFIG) {
    try {
      ACCOUNTS = JSON.parse(env.SAP_CONFIG);
    } catch (e) {
      console.error("SAP_CONFIG Parse Error", e);
    }
  } else {
    ACCOUNTS = defaultAccounts;
  }
}

export default {
  async fetch(request, env, ctx) {
    initConfig(env);
    const url = new URL(request.url);

    if (url.pathname === "/") {
      const allStatus = [];
      for (const acc of ACCOUNTS) {
        if (!acc.apps) continue;
        for (const app of acc.apps) {
          const isHealthy = await checkAppUrl(app.url);
          allStatus.push({
            name: app.name,
            url: app.url,
            email: acc.email,
            healthy: isHealthy
          });
        }
      }
      return new Response(generateStatusPage(allStatus), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    if (url.pathname === "/start") {
      ctx.waitUntil(monitorAllApps("manual"));
      return json({ msg: "Manual trigger started" });
    }
    
    return new Response("SAP Monitor Running");
  },

  async scheduled(event, env, ctx) {
    initConfig(env);
    ctx.waitUntil(monitorAllApps("cron"));
  }
};
