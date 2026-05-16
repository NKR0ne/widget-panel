const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const prototypeRoot = path.resolve(__dirname, '..');
const qaDir = path.join(prototypeRoot, 'qa');
const outPath = path.join(qaDir, 'prototype.png');

app.setPath('userData', path.join(prototypeRoot, '.electron-qa'));
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  fs.mkdirSync(qaDir, { recursive: true });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false,
    },
  });

  await win.loadURL('http://127.0.0.1:5174/');
  await wait(6500);

  const image = await win.capturePage();
  fs.writeFileSync(outPath, image.toPNG());
  console.log(outPath);

  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
