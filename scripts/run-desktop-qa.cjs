const {spawnSync}=require("node:child_process");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"warehouse-desktop-test-"));
const warehouseUi=process.argv.includes("--warehouses-ui");
const seededUi=process.argv.includes("--seeded-ui");
try {
  for (const phase of warehouseUi?["ui"]:["fresh","restart"]) {
    const env={...process.env,WMS_QA_PROFILE:profile,WMS_QA_PHASE:phase};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const entry=seededUi?"pre-phase-5/smoke-ui.cjs":warehouseUi?"smoke-warehouse-ui.cjs":"smoke-desktop.cjs";
    const r=spawnSync(require("electron"),[path.join(__dirname,entry)],{encoding:"utf8",env,timeout:warehouseUi?180000:60000});
    process.stdout.write(r.stdout||"");process.stderr.write(r.stderr||"");
    const success=seededUi?"Seeded UI smoke passed":warehouseUi?"Warehouse UI smoke passed":"Desktop smoke passed";
    if(r.error || r.status!==0 || !r.stdout.includes(success)) throw Error("Desktop QA failed during "+phase);
  }
} finally {
  if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!/^warehouse-desktop-test-[a-z0-9]+$/i.test(path.basename(profile)))throw Error("Refusing cleanup outside generated QA profile");
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:3});
}
