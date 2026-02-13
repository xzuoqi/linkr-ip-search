// IP 地址处理助手
function ip2long(ip) {
    let parts = ip.split('.');
    return (parts[0] * 16777216) + (parts[1] * 65536) + (parts[2] * 256) + (+parts[3]);
}

function long2ip(long) {
    return [
        (long >>> 24) & 0xFF,
        (long >>> 16) & 0xFF,
        (long >>> 8) & 0xFF,
        long & 0xFF
    ].join('.');
}

function generateIpRange(start, end) {
    const startLong = ip2long(start);
    const endLong = ip2long(end);
    const ips = [];

    if (startLong > endLong) return [];

    // 允许最多 2048 个 IP（例如 8 个 /24 子网）
    const max = 2048;
    const count = endLong - startLong + 1;

    if (count > max) {
        if (!confirm(`正在扫描 ${count} 个IP，这可能会很慢。是否继续扫描前 ${max} 个?`)) {
            return [];
        }
        for (let i = 0; i < max; i++) ips.push(long2ip(startLong + i));
    } else {
        for (let i = startLong; i <= endLong; i++) ips.push(long2ip(i));
    }
    return ips;
}

// 根据 IP 和子网掩码计算网络范围
function calculateSubnet(ip, netmask) {
    const ipLong = ip2long(ip);
    const maskLong = ip2long(netmask);

    const networkLong = ipLong & maskLong;
    const broadcastLong = networkLong | (~maskLong & 0xFFFFFFFF);

    // 跳过典型的 /24 用法的网络地址和广播地址，
    // 但对于更宽的范围，我们通常从 network+1 扫描到 broadcast-1
    return {
        start: long2ip(networkLong + 1),
        end: long2ip(broadcastLong - 1)
    };
}

// 常用端口列表
const COMMON_PORTS = [
    21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995,
    1433, 1723, 3306, 3389, 5432, 5900, 6379, 8000, 8080, 8443, 8888, 9200, 27017
];

let currentResults = [];
let filteredResults = [];
let currentPage = 1;
const itemsPerPage = 10;
let socket = null;
let isScanning = false;

document.addEventListener('DOMContentLoaded', async () => {
    // Helper to log messages
    function log(msg) {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logWindow.appendChild(div);
        logWindow.scrollTop = logWindow.scrollHeight;
    }

    // UI Elements
    const scanBtn = document.getElementById('scanBtn');
    const stopBtn = document.getElementById('stopBtn');
    stopBtn.style.display = 'none';
    const statusText = document.getElementById('statusText');
    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');
    const resultsBody = document.getElementById('resultsBody');
    const searchInput = document.getElementById('searchInput');
    const logWindow = document.getElementById('logWindow');
    const portRadios = document.getElementsByName('portMode');
    const customPortsDiv = document.getElementById('customPortsDiv');

    // 分页元素
    const paginationControls = document.getElementById('paginationControls');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    const jumpPageInput = document.getElementById('jumpPageInput');
    const jumpPageBtn = document.getElementById('jumpPageBtn');

    // 处理单选按钮变化
    portRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customPortsDiv.style.display = 'block';
            } else {
                customPortsDiv.style.display = 'none';
            }
        });
    });

    // 初始化 Socket.IO
    try {
        // PakePlus/Electron 离线环境适配：显式连接到本地后端
        const API_BASE = 'http://localhost:3000';
        socket = io(API_BASE);

        // Socket 事件
        socket.on('connect', () => {
            statusText.textContent = '已连接到服务器';
            statusText.style.color = 'green';
        });

        socket.on('connect_error', (error) => {
            statusText.textContent = '连接后端失败 - 演示模式 (功能受限)';
            statusText.style.color = 'orange';
            console.warn("Socket connection error:", error);
        });

        socket.on('disconnect', () => {
            statusText.textContent = '与服务器断开连接';
            statusText.style.color = 'red';
        });

        socket.on('log', (data) => {
            log(data.message);
        });

        socket.on('host-found', (data) => {
            log(`发现主机: ${data.host}`);
        });

        socket.on('progress', (data) => {
            const percent = Math.round((data.current / data.total) * 100);
            progressBar.style.width = `${percent}%`;
            progressText.textContent = `${percent}% (${data.phase === 'discovery' ? '发现主机' : '扫描端口'})`;

            if (data.phase === 'discovery') {
                statusText.textContent = `正在探测主机: ${data.current}/${data.total}`;
            } else {
                statusText.textContent = `正在扫描端口: ${data.current}/${data.total}`;
            }
        });

        socket.on('scan-result', (result) => {
            currentResults.push(result);

            // 应用过滤器（如果有）
            const query = searchInput.value.toLowerCase();
            if (!query || result.host.includes(query) || result.port.toString().includes(query)) {
                if (!query) {
                    filteredResults = currentResults; // Optimization
                } else {
                    filteredResults.push(result);
                }
                renderResults();
            }
        });

        socket.on('scan-complete', (data) => {
            isScanning = false;
            scanBtn.disabled = false;
            stopBtn.disabled = true;
            stopBtn.style.display = 'none';
            statusText.textContent = '';
            progressText.textContent = '';
            log('扫描已完成。');
            renderResults(); // 确保最终状态
        });

        socket.on('scan-stopped', () => {
            isScanning = false;
            scanBtn.disabled = false;
            stopBtn.disabled = true;
            stopBtn.style.display = 'none';
            statusText.textContent = '';
            progressText.textContent = '';
            log('扫描已停止。');
            renderResults();
        });
    } catch (e) {
        console.error("Socket.io initialization failed:", e);
        statusText.textContent = 'Socket.io 初始化失败';
        statusText.style.color = 'red';
    }

    // 加载本地 IP 以预填充范围
    try {
        const API_BASE = 'http://localhost:3000';
        const res = await fetch(`${API_BASE}/api/local-ip`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const ips = await res.json();
        if (ips.length > 0) {
            const lanIp = ips.find(i => i.ip.startsWith('192') || i.ip.startsWith('10') || i.ip.startsWith('172')) || ips[0];

            // 根据子网掩码计算实际子网范围
            const range = calculateSubnet(lanIp.ip, lanIp.netmask);

            document.getElementById('ipStart').value = range.start;
            document.getElementById('ipEnd').value = range.end;
            log(`检测到本地 IP: ${lanIp.ip} (掩码: ${lanIp.netmask})`);
        }
    } catch (e) {
        console.warn("Failed to load local IP (Backend likely not connected):", e);
        // Fallback for demo mode
        if (!document.getElementById('ipStart').value) {
            document.getElementById('ipStart').value = '192.168.1.1';
            document.getElementById('ipEnd').value = '192.168.1.254';
            log('无法获取本地 IP (后端未连接)，使用默认范围演示。');
        }
    }

    // 开始扫描
    scanBtn.addEventListener('click', () => {
        if (!socket || !socket.connected) {
            alert("错误: 未连接到后端服务器。\n\n此应用是一个局域网扫描器，必须在本地运行 Node.js 后端才能执行扫描。\n\n请克隆仓库并在本地运行 `npm start`。");
            return;
        }

        if (isScanning) return;

        const start = document.getElementById('ipStart').value;
        const end = document.getElementById('ipEnd').value;
        const mode = document.querySelector('input[name="portMode"]:checked').value;
        const hostDiscovery = document.getElementById('hostDiscovery').checked;

        if (!start || !end) return alert("请填写 IP 范围");

        const hosts = generateIpRange(start, end);
        if (hosts.length === 0) return;

        let ports = [];
        if (mode === 'common') {
            ports = COMMON_PORTS;
        } else if (mode === 'all') {
            if (!confirm("扫描多个主机的全部 65535 个端口将耗费极长时间。确定要继续吗？")) return;
            // 生成 1..65535
            ports = Array.from({ length: 65535 }, (_, i) => i + 1);
        } else {
            const portsStr = document.getElementById('ports').value;
            // 处理范围语法，如 "1-100" 或逗号分隔
            const parts = portsStr.split(',');
            parts.forEach(p => {
                if (p.includes('-')) {
                    const [min, max] = p.split('-').map(Number);
                    if (!isNaN(min) && !isNaN(max) && max >= min) {
                        for (let i = min; i <= max; i++) ports.push(i);
                    }
                } else {
                    const val = parseInt(p.trim());
                    if (!isNaN(val)) ports.push(val);
                }
            });
        }

        if (ports.length === 0) return alert("未选择有效端口");

        // UI 重置
        isScanning = true;
        scanBtn.disabled = true;
        stopBtn.disabled = false;
        stopBtn.style.display = 'inline-block';
        currentResults = [];
        filteredResults = [];
        currentPage = 1;
        renderResults(); // 显示“正在扫描...”

        progressBar.style.width = '0%';
        logWindow.innerHTML = ''; // 清除日志

        // 发送开始事件
        socket.emit('start-scan', {
            hosts,
            ports,
            options: { hostDiscovery }
        });
    });

    // 停止扫描
    stopBtn.addEventListener('click', () => {
        if (!isScanning) return;
        socket.emit('stop-scan');
        stopBtn.disabled = true; // 防止双击
        log('正在停止扫描...');
    });

    // 搜索/过滤
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();

        if (!query) {
            filteredResults = [...currentResults];
        } else {
            filteredResults = currentResults.filter(item =>
                item.host.includes(query) ||
                item.port.toString().includes(query)
            );
        }

        currentPage = 1;
        renderResults();
    });
});
