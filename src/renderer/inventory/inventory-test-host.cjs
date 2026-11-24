const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const directory = process.argv[2];
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 700,
    webPreferences: { backgroundThrottling: false },
  });
  await window.loadFile(path.join(directory, "index.html"));
  const results = await window.webContents.executeJavaScript("window.runInventoryTests()");
  console.log("INVENTORY_RESULTS " + JSON.stringify(results));
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
