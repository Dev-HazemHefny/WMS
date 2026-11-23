// Run under Electron, with a fresh application profile for each invocation.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const phase=process.env.WMS_QA_PHASE;
const profile=process.env.WMS_QA_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(),"warehouse-desktop-test-"));
if(path.dirname(profile)!==os.tmpdir() || !/^warehouse-desktop-test-[a-z0-9]+$/i.test(path.basename(profile)))throw Error("Expected a disposable QA profile");
const checkpoint=phase==="restart"?JSON.parse(fs.readFileSync(path.join(profile,"qa-hierarchy.json"),"utf8")):null;
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
     if(!(await api.identity.getCapabilities()).permissions.includes("warehouse.reparent"))throw Error("Lost Warehouse permissions after restart");
     const branches=await api.warehouses.branches.list({search:"IPC branch"});
     if(branches.total!==1)throw Error("Lost dedicated Warehouse definitions after restart");
     const saved=${JSON.stringify(checkpoint)};
     const nested=await api.warehouses.locations.get({id:saved.nested});
     if(nested.warehouse.id!==saved.warehouse || nested.branch.id!==saved.branch || nested.location.parentId!==saved.shelf || !nested.location.isStockable || !nested.effectiveActive)throw Error("Lost persisted hierarchy identity or state");
     if(JSON.stringify(nested.path.map(node=>node.id))!==JSON.stringify([saved.zone,saved.shelf,saved.nested]))throw Error("Lost persisted breadcrumbs");
     if(!(await api.warehouses.locations.tree({warehouseId:saved.warehouse,parentId:saved.shelf})).some(node=>node.id===saved.nested))throw Error("Lost nested location after restart");
     const stock=api.inventory.execute;
     const document=(await stock({op:"documents"})).rows.find(d=>d.kind==="receipt").id;
     await stock({op:"post",document,version:1,command:"smoke"});
     if((await stock({op:"balances"})).rows[0].thousandths!=="10000" || (await stock({op:"reconcile"})).rows.length)throw Error("Restart retry changed stock");
     return {restart:true,hierarchyPersistence:true};
   })()` : `(async()=>{
    const api=window.warehouse;
    if(!await api.identity.setupRequired())throw Error("Unexpected initialized profile");
    await api.identity.login({name:"test",password:"test-password-123",setup:true});
    const permissions=(await api.identity.getCapabilities()).permissions;
    if(!["read","warehouse","warehouse.status","warehouse.reparent","warehouse.reassign"].every(p=>permissions.includes(p)))throw Error("Admin Warehouse capabilities missing");
    const ipcBranch=await api.warehouses.branches.create({code:"IPC_BRANCH",name:"IPC branch"});
    const ipcWarehouse=await api.warehouses.warehouses.create({branchId:ipcBranch.id,code:"IPC_WH",name:"IPC warehouse"});
    const ipcDetails=await api.warehouses.warehouses.get({id:ipcWarehouse.id});
    if(!ipcDetails.defaultLocation.isDefault)throw Error("Missing default location");
    const zone=await api.warehouses.locations.create({warehouseId:ipcWarehouse.id,code:"ZONE",name:"Zone",locationType:"zone"});
    const bin=await api.warehouses.locations.create({warehouseId:ipcWarehouse.id,parentId:zone.id,code:"BIN",name:"Bin",locationType:"bin"});
    if((await api.warehouses.locations.path({id:bin.id})).length!==2 || (await api.warehouses.locations.tree({warehouseId:ipcWarehouse.id,parentId:zone.id}))[0].id!==bin.id)throw Error("Invalid IPC hierarchy");
    if((await api.warehouses.locations.reparent({id:bin.id,parentId:null,expectedVersion:1})).version!==2)throw Error("IPC reparent failed");
    const shelf=await api.warehouses.locations.create({warehouseId:ipcWarehouse.id,parentId:zone.id,code:"SHELF",name:"Shelf",locationType:"shelf"});
    const nested=await api.warehouses.locations.create({warehouseId:ipcWarehouse.id,parentId:shelf.id,code:"NESTED",name:"Nested bin",locationType:"bin"});
    const hierarchy={branch:ipcBranch.id,warehouse:ipcWarehouse.id,zone:zone.id,shelf:shelf.id,nested:nested.id};
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
    const readerCapabilities=await api.identity.getCapabilities();
    if(!readerCapabilities.authenticated || JSON.stringify(readerCapabilities.permissions)!=='["read"]')throw Error("Stale admin capabilities after switch");
    let warehouseDenied=false;
    try{await api.warehouses.branches.create({code:"FORBIDDEN",name:"Forbidden"})}catch(e){if(!String(e).includes("الصلاحية غير متاحة"))throw e;warehouseDenied=true}
    if(!warehouseDenied || (await api.warehouses.branches.list({search:"Forbidden"})).total!==0)throw Error("Warehouse RBAC failed");
    let denied=false;
    try{await stock({op:"reverse",document,command:"forbidden"})}catch(e){if(!String(e).includes("الصلاحية غير متاحة"))throw e;denied=true}
    if(!denied || (await stock({op:"balances"})).rows[0].thousandths!=="10000")throw Error("User switching failed");
    await api.identity.logout();
    if(JSON.stringify(await api.identity.getCapabilities())!==JSON.stringify({authenticated:false,permissions:[]}))throw Error("Stale capabilities after logout");
    try{await stock({op:"balances"})}catch(e){if(!String(e).includes("تسجيل الدخول مطلوب"))throw e;return {postMs,receiptQuantity:10,hierarchy}}
    throw Error("Logout failed");
   })()`);
   if(phase!=="restart")fs.writeFileSync(path.join(profile,"qa-hierarchy.json"),JSON.stringify(result.hierarchy));
   console.log("Desktop smoke passed",JSON.stringify(result));clearTimeout(deadline);app.quit();
  }catch(error){console.error(error);clearTimeout(deadline);app.exit(1)}
 });
});
const source=process.argv[2]||path.resolve("out/main/index.js");
require(path.resolve(source));
