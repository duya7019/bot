const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

process.on('uncaughtException', (err) => console.error('[Error]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Error]', reason));

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || 3000);
const configPath = path.join(__dirname, 'config.json');

// 1. 动态获取当前容器真实公网 IP
let IP = '';
const fetchPublicIP = () => {
  const apis = [
    'curl -sSL --max-time 3 https://api.ipify.org',
    'curl -sSL --max-time 3 https://ifconfig.me',
    'curl -sSL --max-time 3 https://icanhazip.com'
  ];
  for (const cmd of apis) {
    try {
      const ip = execSync(cmd, { encoding: 'utf8' }).trim();
      if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.startsWith('0.') && !ip.startsWith('127.')) {
        return ip;
      }
    } catch (e) {}
  }
  return '127.0.0.1';
};

IP = fetchPublicIP();

// 2. 纯动态 PTR 反向解析：向 DNS 询问当前 IP 绑定的真实域名（零字典、零硬编码）
async function getDynamicDomain(targetIp) {
  if (!targetIp || targetIp === '127.0.0.1') return null;
  try {
    const hostnames = await dns.reverse(targetIp);
    if (hostnames && hostnames.length > 0) {
      // 自动返回如 fi14.bot-hosting.cloud 或新服务器绑定的 PTR 域名
      return hostnames[0];
    }
  } catch (e) {
    // 若机房未配置 PTR 记录，退回获取主机名
  }
  return null;
}

// 3. 清理残留进程
try {
  execSync('pkill -f web || true');
  execSync('pkill -f npm-runner || true');
} catch (e) {}

// 4. 动态读取 UUID 并写入配置文件
let UUID = 'c4e94351-abb0-11f1-8000-fbb82174a6dc';
try {
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData.inbounds?.[0]?.users?.[0]?.uuid) {
      UUID = configData.inbounds[0].users[0].uuid;
    }
  }
} catch (e) {
  console.error('[Config Read Error]', e.message);
}

const finalConfig = {
  log: { level: "info" },
  inbounds: [{
    type: "vless",
    tag: "vless-in",
    listen: "0.0.0.0",
    listen_port: PORT,
    users: [{ uuid: UUID }],
    transport: { type: "ws", path: "/vless-ws" }
  }],
  outbounds: [{ type: "direct", tag: "direct" }]
};

fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));

// 5. 自动解密并拉取二进制组件
const decode = (str) => Buffer.from(str, 'base64').toString('utf-8');
const URL_CORE = decode('aHR0cHM6Ly9naXRodWIuY29tL1NhZ2VyTmV0L3NpbmctYm94L3JlbGVhc2VzL2Rvd25sb2FkL3YxLjkuMy9zaW5nLWJveC0xLjkuMy1saW51eC1hbWQ2NC50YXIuZ3o=');
const URL_TUNNEL = decode('aHR0cHM6Ly9naXRodWIuY29tL2Nsb3VkZmxhcmUvY2xvdWRmbGFyZWQvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2Nsb3VkZmxhcmVkLWxpbnV4LWFtZDY0');

const BIN_CORE = path.join(__dirname, 'web');
const BIN_TUNNEL = path.join(__dirname, 'npm-runner');
const ua = 'npm/9.6.7 node/v18.16.0 linux x64';

if (!fs.existsSync(BIN_CORE)) {
  try {
    console.log('[Core] Downloading Sing-box core...');
    execSync(`curl -A "${ua}" -sSL "${URL_CORE}" | tar -xz -C /tmp && mv /tmp/sing-box-*/sing-box ${BIN_CORE} && chmod +x ${BIN_CORE}`);
  } catch (e) { console.error('[Core Download Failed]:', e.message); }
}

if (!fs.existsSync(BIN_TUNNEL)) {
  try {
    console.log('[Tunnel] Downloading cloudflared...');
    execSync(`curl -A "${ua}" -sSL -o ${BIN_TUNNEL} "${URL_TUNNEL}" && chmod +x ${BIN_TUNNEL}`);
  } catch (e) { console.error('[Tunnel Download Failed]:', e.message); }
}

// 6. 启动 Sing-box
if (fs.existsSync(BIN_CORE)) {
  const runCore = () => {
    console.log(`[Core] Launching Sing-box on port ${PORT}...`);
    const sb = spawn(BIN_CORE, ['run', '-c', 'config.json']);
    sb.stdout.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.stderr.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.on('exit', () => setTimeout(runCore, 3000));
  };
  runCore();
}

// 7. 启动隧道并自动打印纯动态获取的节点
if (fs.existsSync(BIN_TUNNEL)) {
  const runTunnel = async () => {
    console.log('[Tunnel] Starting Cloudflare Tunnel...');
    const domainName = await getDynamicDomain(IP);
    const cf = spawn(BIN_TUNNEL, ['tunnel', '--url', `http://127.0.0.1:${PORT}`]);
    let printed = false;
    
    cf.stderr.on('data', data => {
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !printed) {
        printed = true;
        const sub = match[0].replace('https://', '');
        console.log('\n==================================================');
        console.log(`[Auto-Detect] 真实外网 IP: ${IP}`);
        console.log(`[Auto-Detect] PTR 反查解析域名: ${domainName || '机房未绑定反向 PTR 记录'}`);
        console.log(`[UUID Sync] 生效 UUID: ${UUID}`);
        
        console.log('\n🚀【CF 隧道加密节点链接】:');
        console.log(`vless://${UUID}@${sub}:443?encryption=none&security=tls&sni=${sub}&type=ws&host=${sub}&path=%2Fvless-ws#CF-Tunnel`);
        
        console.log('\n⚡【原生 IP 直连节点链接】:');
        console.log(`vless://${UUID}@${IP}:${PORT}?encryption=none&security=none&type=ws&host=${IP}&path=%2Fvless-ws#Native-IP-Direct`);
        
        if (domainName) {
          console.log('\n🌐【原生域名直连节点链接】:');
          console.log(`vless://${UUID}@${domainName}:${PORT}?encryption=none&security=none&type=ws&host=${domainName}&path=%2Fvless-ws#Native-Domain-Direct`);
        }
        console.log('==================================================\n');
      }
    });
    cf.on('exit', () => setTimeout(runTunnel, 5000));
  };
  runTunnel();
}

setInterval(() => {}, 100000);
