// Run under Electron, with a fresh application profile for each invocation.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const phase=process.env.WMS_QA_PHASE;
const profile=process.env.WMS_QA_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(),"warehouse-desktop-test-"));
if(path.dirname(profile)!==os.tmpdir() || !/^warehouse-desktop-test-[a-z0-9]+$/i.test(path.basename(profile)))throw Error("Expected a disposable QA profile");
app.setPath("userData",profile);
app.disableHardwareAcceleration();
const deadline=setTimeout(()=>{console.error("Desktop startup timed out");app.exit(1)},45000);
app.once("browser-window-created",(_event,win)=>{
 win.webContents.once("did-finish-load",async()=>{
  try{
   const result=await win.webContents.executeJavaScript(phase==="restart" ? `(async()=>{
     const api=window.warehouse;
     if(await api.identity.setupRequired())throw Error("Lost operator after restart");
     await api.identity.login({name:"test",password:"test-password-123",setup:false});
     const stock=api.inventory.execute;
     const document=(await stock({op:"documents"})).rows.find(d=>d.kind==="receipt").id;
     await stock({op:"post",document,version:1,command:"smoke"});
     if((await stock({op:"balances"})).rows[0].thousandths!=="10000" || (await stock({op:"reconcile"})).rows.length)throw Error("Restart retry changed stock");
     return {restart:true};
   })()` : `(async()=>{
    const api=window.warehouse;
    if(!await api.identity.setupRequired())throw Error("Unexpected initialized profile");
    await api.identity.login({name:"test",password:"test-password-123",setup:true});
    const category=await api.catalog.categories.create({code:"GENERAL",name:"General"});
    const unit=await api.catalog.units.create({name:"Each",symbol:"ea",dimension:"count"});
    await api.catalog.products.create({name:"Sample",sku:"SAMPLE",categoryId:category.id,baseUnitId:unit.id,allowDecimalQuantity:false,productType:"simple"});
    const stock=api.inventory.execute;
    const branch=(await stock({op:"branch",name:"Branch"})).id;
    await stock({op:"warehouse",name:"Warehouse",branch});
    const item=(await stock({op:"items"})).rows[0].id,location=(await stock({op:"places"})).rows[0].id;
    const document=(await stock({op:"draft",kind:"receipt",lines:[{item,location,quantity:"10"}]})).id;
    const start=performance.now();
    await stock({op:"post",document,version:1,command:"smoke"});const postMs=performance.now()-start;
    await stock({op:"post",document,version:1,command:"smoke"});
    if((await stock({op:"balances"})).rows[0].thousandths!=="10000"||(await stock({op:"reconcile"})).rows.length)throw Error("Inventory mismatch");
    await api.identity.add({name:"reader",password:"other-test-password",roles:["clerk"]});
    await api.identity.login({name:"reader",password:"other-test-password",setup:false});
    let denied=false;
    try{await stock({op:"reverse",document,command:"forbidden"})}catch(e){if(!String(e).includes("الصلاحية غير متاحة"))throw e;denied=true}
    if(!denied || (await stock({op:"balances"})).rows[0].thousandths!=="10000")throw Error("User switching failed");
    await api.identity.logout();
    try{await stock({op:"balances"})}catch(e){if(!String(e).includes("تسجيل الدخول مطلوب"))throw e;return {postMs,receiptQuantity:10}}
    throw Error("Logout failed");
   })()`);
   console.log("Desktop smoke passed",JSON.stringify(result));clearTimeout(deadline);app.quit();
  }catch(error){console.error(error);clearTimeout(deadline);app.exit(1)}
 });
});
const source=process.argv[2]||path.resolve("out/main/index.js");
require(path.resolve(source));
