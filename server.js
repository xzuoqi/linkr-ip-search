const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const net = require('net');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push({ name, ip: iface.address, netmask: iface.netmask });
            }
        }
    }
    return ips;
}

function checkPort(host, port, timeout = 2000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = 'closed';
        let resolved = false;

        const done = () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve({ host, port, status });
            }
        };

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            status = 'open';
            done();
        });

        socket.on('timeout', () => {
            done();
        });

        socket.on('error', (err) => {
            done();
        });

        socket.on('close', () => {
            done();
        });

        socket.connect(port, host);

        // 安全回退：超时 + 缓冲后强制解决
        setTimeout(() => {
            done();
        }, timeout + 500);
    });
}

// 主机发现：检查主机是否对常用端口有响应
async function isHostUp(host) {
    const commonPorts = [80, 443, 22, 135, 445, 3389, 8080];
    const checks = commonPorts.map(p => checkPort(host, p, 1000));
    const results = await Promise.all(checks);
    return results.some(r => r.status === 'open');
}

io.on('connection', (socket) => {
    console.log('A user connected');
    let stopScan = false;

    socket.on('start-scan', async (data) => {
        const { hosts, ports, options } = data;
        stopScan = false;

        console.log(`Starting scan: ${hosts.length} hosts, ${ports.length} ports`);

        // 1. 主机发现阶段（可选，但建议用于大型扫描）
        let activeHosts = hosts;
        if (options && options.hostDiscovery && hosts.length > 1) {
            socket.emit('log', { message: `正在对 ${hosts.length} 个 IP 进行主机发现...` });
            activeHosts = [];

            // 批量处理主机发现
            const discoveryBatchSize = 50;
            for (let i = 0; i < hosts.length; i += discoveryBatchSize) {
                if (stopScan) break;
                const batch = hosts.slice(i, i + discoveryBatchSize);
                const promises = batch.map(async (host) => {
                    const isUp = await isHostUp(host);
                    if (isUp) {
                        activeHosts.push(host);
                        socket.emit('host-found', { host });
                    }
                    return isUp;
                });
                await Promise.all(promises);
                socket.emit('progress', {
                    phase: 'discovery',
                    current: Math.min(i + discoveryBatchSize, hosts.length),
                    total: hosts.length
                });
            }
            socket.emit('log', { message: `主机发现完成。发现 ${activeHosts.length} 个活跃主机。` });
        }

        if (stopScan) {
            socket.emit('scan-stopped');
            return;
        }

        if (activeHosts.length === 0) {
            socket.emit('scan-complete', { results: [] });
            return;
        }

        // 2. 端口扫描阶段
        const concurrency = 200; // 并发连接数
        let totalScanned = 0;
        const totalToScan = activeHosts.length * ports.length;

        // 创建任务队列
        const tasks = [];
        for (const host of activeHosts) {
            for (const port of ports) {
                tasks.push({ host, port });
            }
        }

        socket.emit('log', { message: `开始扫描 ${activeHosts.length} 个主机上的端口 (共 ${totalToScan} 次检测)...` });

        // 简单的工作线程池
        let taskIndex = 0;
        const worker = async () => {
            while (taskIndex < tasks.length && !stopScan) {
                const task = tasks[taskIndex++];
                if (!task) break; // 安全检查

                const result = await checkPort(task.host, task.port, 800);

                if (result.status === 'open') {
                    socket.emit('scan-result', result);
                }

                totalScanned++;
                if (totalScanned % 50 === 0 || totalScanned === totalToScan) {
                    socket.emit('progress', {
                        phase: 'scanning',
                        current: totalScanned,
                        total: totalToScan
                    });
                }
            }
        };

        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(worker());
        }

        await Promise.all(workers);

        if (stopScan) {
            socket.emit('scan-stopped');
        } else {
            socket.emit('scan-complete');
        }
    });

    socket.on('stop-scan', () => {
        stopScan = true;
    });

    socket.on('disconnect', () => {
        stopScan = true;
        console.log('User disconnected');
    });
});

app.get('/api/local-ip', (req, res) => {
    res.json(getLocalIPs());
});

// 导出 startServer 函数以便 Electron 调用，或者直接运行
function startServer() {
    return new Promise((resolve, reject) => {
        server.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
            resolve(server);
        });
        server.on('error', (err) => {
            console.error('Server failed to start:', err);
            reject(err);
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { startServer, app, server };
