const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let mainWindow;

async function createWindow() {
  // 1. 启动 Express 后端
  try {
    // 检查是否已经在运行（例如在开发模式下）
    // 但对于生产环境打包，我们总是尝试启动它
    await startServer();
    console.log('Backend server started');
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('Server already running, proceeding...');
    } else {
      console.error('Failed to start server:', err);
    }
  }

  // 2. 创建窗口
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: "LAN Port Scanner",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 3. 加载应用
  // 注意：我们加载的是本地服务器 URL，而不是文件
  // 这样可以确保 Socket.io 和 API 正常工作
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
