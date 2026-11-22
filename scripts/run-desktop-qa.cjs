const {spawnSync}=require("node:child_process");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"warehouse-desktop-test-"));
try {
  for (const phase of ["fresh","restart"]) {
    const env={...process.env,WMS_QA_PROFILE:profile,WMS_QA_PHASE:phase};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const r=spawnSync(require("electron"),[path.join(__dirname,"smoke-desktop.cjs")],{encoding:"utf8",env,timeout:60000});
    process.stdout.write(r.stdout||"");process.stderr.write(r.stderr||"");
    if(r.error || r.status!==0 || !r.stdout.includes("Desktop smoke passed")) throw Error("Desktop QA failed during "+phase);
  }
} finally { fs.rmSync(profile,{recursive:true,force:true,maxRetries:3}); }
