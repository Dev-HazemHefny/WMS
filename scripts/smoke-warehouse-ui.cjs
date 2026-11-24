// Actual React DOM + contextBridge + SQLite checks; launched by run-desktop-qa.cjs.
const {app}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const profile=process.env.WMS_QA_PROFILE;
const evidencePrefix=process.env.WMS_QA_EVIDENCE_PREFIX||"phase3-stage7";
if(!/^(?:phase3-stage[78]|phase4-stage7)(?:-baseline)?$/.test(evidencePrefix))throw Error("Invalid QA evidence prefix");
if(!profile||path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!/^warehouse-desktop-test-[a-z0-9]+$/i.test(path.basename(profile)))throw Error("A disposable QA profile is required");
app.setPath("userData",profile);app.disableHardwareAcceleration();
const deadline=setTimeout(()=>{console.error("Warehouse UI timed out");app.exit(1);},170000);
const steps=[
  ["setup",async function(){
    const wait=async(test,label)=>{const until=Date.now()+10000;while(Date.now()<until){if(test())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error("Timed out: "+label+" | "+document.body.innerText.slice(-1800));};
    const check=(value,label)=>{if(!value)throw Error(label);window.__qa.checks.push(label);};
    const find=(text,scope=document)=>Array.from(scope.querySelectorAll("button,a")).find(node=>node.textContent.trim()===text);
    const click=async(text,scope=document)=>{const node=find(text,scope);if(!node||node.disabled)throw Error("Missing/enabled control: "+text);node.click();await new Promise(resolve=>setTimeout(resolve,50));};
    const fill=async(selector,value,scope=document)=>{const node=scope.querySelector(selector);if(!node)throw Error("Missing input "+selector);const prototype=node.tagName==="SELECT"?HTMLSelectElement.prototype:node.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(node,value);node.dispatchEvent(new Event("input",{bubbles:true}));node.dispatchEvent(new Event("change",{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,25));};
    const submit=async(form)=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,60));};
    const route=async(target,title)=>{location.hash=target;await wait(()=>document.querySelector(".page-title h2")?.textContent===title,title);await wait(()=>!document.querySelector(".state-card[role=status]"),"route data "+target);};
    window.__qa={wait,check,find,click,fill,submit,route,checks:[]};
    await wait(()=>document.querySelector(".login-card button:not(:disabled)"),"initial setup");
    await fill('[name="name"]',"ui-admin");await fill('[name="password"]',"test-password-123");await submit(document.querySelector(".login-card form"));
    await wait(()=>document.querySelector(".side-nav"),"authenticated shell");
    const api=window.warehouse;
    const b=await api.warehouses.branches.create({code:"UI_BASE",name:"الفرع الأساسي"});
    const w=await api.warehouses.warehouses.create({branchId:b.id,code:"UI_WH",name:"المخزن التجريبي"});
    const root=await api.warehouses.locations.create({warehouseId:w.id,code:"ZONE",name:"منطقة التجربة",locationType:"zone",isStockable:true});
    const child=await api.warehouses.locations.create({warehouseId:w.id,parentId:root.id,code:"BIN",name:"خانة التجربة",locationType:"bin"});
    let ancestor=child.id;
    for(let i=0;i<12;i++)ancestor=(await api.warehouses.locations.create({warehouseId:w.id,parentId:ancestor,code:"DEEP_"+i,name:"مستوى "+i,locationType:"shelf"})).id;
    const category=await api.catalog.categories.create({code:"UI",name:"أصناف التجربة"}),unit=await api.catalog.units.create({name:"قطعة",symbol:"pc",dimension:"count"});
    const longName = "صنف التجربة للاستخدام في المخازن المركزية ومواقع التخزين الفرعية ومراجعة الأرصدة اليومية";
    const product=(await api.catalog.products.create({name:longName,sku:"UI_SKU",productType:"simple",categoryId:category.id,baseUnitId:unit.id,allowDecimalQuantity:false})).product;
    await api.identity.add({name:"ui-clerk",password:"test-password-456",roles:["clerk"]});
    Object.assign(window.__qa,{b,w,root,child,product,deep:ancestor,item:(await api.inventory.execute({op:"items"})).rows[0].id});
    check(document.documentElement.dir==="rtl","Arabic RTL shell");
  }],
  ["branches",async function(){
    const q=window.__qa,{wait,check,click,fill,submit,route}=q;
    await click("الفروع",document.querySelector(".side-nav"));await wait(()=>document.querySelector(".page-title h2")?.textContent==="الفروع","branch sidebar");
    check(document.querySelector('a[href="#/branches"]').classList.contains("active"),"Branch active navigation");
    await click("إضافة فرع");let dialog=document.querySelector('[role="dialog"]');
    check(dialog.contains(document.activeElement),"Dialog receives keyboard focus");
    await fill('[name="code"]',"UI_NEW",dialog);await fill('[name="name"]',"فرع واجهة",dialog);await fill('[name="phone"]',"01012345678",dialog);await submit(dialog);
    await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector("tbody")?.textContent.includes("فرع واجهة"),"branch create");check(true,"Branch create through React form");
    await fill('.search-field input',"UI_NEW");await wait(()=>document.querySelectorAll("tbody tr").length===1&&document.querySelector("tbody").textContent.includes("فرع واجهة"),"branch search");check(true,"Branch search by code");
    await click("تعديل");dialog=document.querySelector('[role="dialog"]');await fill('[name="name"]',"فرع واجهة معدل",dialog);await submit(dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector("tbody")?.textContent.includes("فرع واجهة معدل"),"branch edit");check(true,"Versioned branch edit");
    await click("تعطيل");await click("تأكيد تغيير الحالة",document.querySelector('[role="dialog"]'));await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector("tbody")?.textContent.includes("غير نشط"),"branch deactivate");check(true,"Branch status confirmation");
    const branch=(await window.warehouse.warehouses.branches.list({search:"UI_NEW"})).items[0];q.branch=branch;
    await fill('.filters select',"active");await wait(()=>!document.querySelector("tbody"),"status filter");check(true,"Branch status filter");await fill('.filters select',"all");await wait(()=>document.querySelector("tbody"),"restore filter");
    // The UI captured this version before an independent authorized edit.
    await window.warehouse.warehouses.branches.update({id:branch.id,expectedVersion:branch.version,code:branch.code,name:"تحديث مستقل"});
    await click("تعديل");dialog=document.querySelector('[role="dialog"]');await fill('[name="name"]',"تعديل قديم",dialog);await submit(dialog);await wait(()=>dialog.textContent.includes("تغيّرت البيانات"),"version conflict");check(true,"Stale version conflict is actionable");
    await click("إعادة تحميل البيانات الحالية",dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector("tbody")?.textContent.includes("تحديث مستقل"),"conflict reload");
    await fill('.search-field input',"");await wait(()=>document.querySelector("tbody")?.textContent.includes("الفرع الأساسي"),"clear search");
    const baseRow=Array.from(document.querySelectorAll("tbody tr")).find(row=>row.textContent.includes("الفرع الأساسي"));await click("التفاصيل والمخازن",baseRow);await wait(()=>document.querySelector('[role="dialog"]')?.textContent.includes("المخزن التجريبي"),"associated warehouses");check(true,"Branch details link associated Warehouse");await click("إغلاق",document.querySelector('[role="dialog"]'));
    await route("/branches","الفروع");
  }],
  ["pagination",async function(){
    const {wait,check,click,fill}=window.__qa;
    for(let i=0;i<16;i++)await window.warehouse.warehouses.branches.create({code:"PAGE_"+String(i).padStart(2,"0"),name:"فرع صفحات "+i});
    await fill('.search-field input',"PAGE_");await wait(()=>document.querySelectorAll("tbody tr").length===15,"first page");await click("التالي");await wait(()=>document.querySelectorAll("tbody tr").length===1,"next page");check(true,"Server-paginated Branch results");
    await click("السابق");await wait(()=>document.querySelectorAll("tbody tr").length===15,"previous page");check(true,"Previous page navigation");
  }],
  ["warehouses",async function(){
    const q=window.__qa,{wait,check,click,fill,submit,route}=q;
    await route("/warehouses","المخازن");await click("إضافة مخزن");let dialog=document.querySelector('[role="dialog"]');await wait(()=>dialog.querySelectorAll('select[name="branchId"] option').length>1,"active branches");
    check(!Array.from(dialog.querySelectorAll('select option')).some(node=>node.textContent.includes("تحديث مستقل")),"Inactive branch excluded from creation");
    await fill('[name="code"]',"UI_CREATED",dialog);await fill('[name="name"]',"مخزن الواجهة",dialog);await fill('[name="branchId"]',q.b.id,dialog);await submit(dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector("tbody")?.textContent.includes("مخزن الواجهة"),"Warehouse create");check(true,"Warehouse creation with active owning branch");
    q.created=(await window.warehouse.warehouses.warehouses.list({search:"UI_CREATED"})).items[0];
    await fill('.search-field input',"UI_CREATED");await wait(()=>document.querySelectorAll("tbody tr").length===1,"Warehouse search");check(true,"Warehouse search by code");await fill('.filters select',"inactive");await wait(()=>!document.querySelector("tbody"),"Warehouse status filter");check(true,"Warehouse status filter");await fill('.filters select',"all");await fill('.search-field input',"");
    await route(`/warehouses/${q.created.id}`,q.created.name);await click("تعديل المخزن");dialog=document.querySelector('[role="dialog"]');await fill('[name="name"]',"مخزن واجهة معدل",dialog);await submit(dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector('.page-title h2')?.textContent==="مخزن واجهة معدل","Warehouse metadata edit");q.created.name="مخزن واجهة معدل";check(true,"Versioned Warehouse metadata edit");
    await route(`/warehouses/${q.w.id}`,q.w.name);await wait(()=>document.body.textContent.includes("الموقع الافتراضي"),"Warehouse details");check(document.body.textContent.includes("الفرع الأساسي"),"Warehouse details display owner and default");
    await click("تعطيل المخزن");await click("تأكيد تغيير الحالة",document.querySelector('[role="dialog"]'));await wait(()=>document.querySelector('[role="dialog"]')?.textContent.includes("عطّل المواقع التابعة"),"lifecycle restriction");check(true,"Backend lifecycle restriction displayed");await click("إلغاء",document.querySelector('[role="dialog"]'));
    await route(`/warehouses/${q.created.id}`,q.created.name);await click("تعطيل المخزن");await click("تأكيد تغيير الحالة",document.querySelector('[role="dialog"]'));await wait(()=>!document.querySelector('[role="dialog"]')&&document.body.textContent.includes("تفعيل المخزن"),"empty Warehouse deactivate");
    const destination=await window.warehouse.warehouses.branches.create({code:"UI_DEST",name:"فرع الوجهة"});q.destination=destination;
    await click("نقل تبعية الفرع");dialog=document.querySelector('[role="dialog"]');await wait(()=>Array.from(dialog.querySelectorAll("option")).some(node=>node.value===destination.id),"reassignment candidates");await fill('[name="branchId"]',destination.id,dialog);await click("تأكيد نقل التبعية",dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector(".warehouse-metadata")?.textContent.includes("فرع الوجهة"),"reassignment");check(true,"Authorized branch reassignment through UI");
    await route(`/warehouses/${q.w.id}/locations`,"مواقع التخزين");
  }],
  ["locations",async function(){
    const q=window.__qa,{wait,check,click,fill,submit}=q;
    await wait(()=>document.querySelector('[data-tree-select]'),"root locations");check(!document.querySelector(`[data-tree-select="${q.child.id}"]`),"Hierarchy starts lazy and collapsed");
    const expander=Array.from(document.querySelectorAll(".tree-expander")).find(node=>node.getAttribute("aria-label").includes(q.root.name));expander.click();await wait(()=>document.querySelector(`[data-tree-select="${q.child.id}"]`),"expand root");check(true,"Nested hierarchy expands");
    document.querySelector(`[data-tree-select="${q.child.id}"]`).click();await wait(()=>document.querySelector('.location-details h3')?.textContent===q.child.name,"select nested row before collapse");
    expander.click();await wait(()=>!document.querySelector(`[data-tree-select="${q.child.id}"]`),"collapse root");check(true,"Hierarchy collapses");
    check(Array.from(document.querySelectorAll('[data-tree-select]')).some(node=>node.tabIndex===0),"Tree stays keyboard-reachable when selected child is collapsed");
    const rootControl=document.querySelector(`[data-tree-select="${q.root.id}"]`);rootControl.focus();rootControl.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true}));await wait(()=>document.querySelector(`[data-tree-select="${q.child.id}"]`),"keyboard expand");rootControl.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}));await wait(()=>!document.querySelector(`[data-tree-select="${q.child.id}"]`),"keyboard collapse");check(true,"Hierarchy supports keyboard expansion and collapse");
    await fill('.search-field input',"BIN");await wait(()=>q.find(`إظهار «${q.child.name}» في الشجرة`),"location search");await click(`إظهار «${q.child.name}» في الشجرة`);await wait(()=>document.querySelector('.location-details h3')?.textContent===q.child.name,"search reveal");check(document.querySelector('[aria-label="مسار الموقع"]').textContent.includes(q.root.name),"Search reveals ancestors and breadcrumbs");
    check(document.querySelector('.location-details').textContent.includes("لا يشمل المواقع الفرعية"),"Exact-location counting notice");
    await fill('.search-field input',"DEEP_11");await wait(()=>q.find("إظهار «مستوى 11» في الشجرة"),"deep search");await click("إظهار «مستوى 11» في الشجرة");await wait(()=>document.querySelector('.location-details h3')?.textContent==="مستوى 11","deep reveal");check(Number(document.querySelector(`[data-tree-select="${q.deep}"]`).parentElement.getAttribute("aria-level"))>10,"Deep hierarchy reveals ancestor chain iteratively");
    document.querySelector(`[data-tree-select="${q.child.id}"]`).click();await wait(()=>document.querySelector('.location-details h3')?.textContent===q.child.name,"restore child");
    await click("نقل الموقع داخل المخزن");let dialog=document.querySelector('[role="dialog"]');await wait(()=>dialog.querySelector(".parent-options"),"parent picker");check(!dialog.querySelector('input[name="parentId"]'),"Parent selector exposes no raw ID field");
    const self=Array.from(dialog.querySelectorAll('.parent-options button')).find(node=>node.textContent.includes(q.child.name));check(self.disabled,"Parent picker rejects self/cyclic parent");await click("اختيار جذر المخزن",dialog);await click("حفظ",dialog);await wait(()=>!document.querySelector('[role="dialog"]'),"reparent");await wait(()=>document.querySelector('.location-details [aria-label="مسار الموقع"]')?.textContent.trim()===q.child.name,"updated path");check(true,"Reparent updates path and keeps identity");
    await click("إضافة موقع جذري");dialog=document.querySelector('[role="dialog"]');await fill('[name="code"]',"UI_ROOT",dialog);await fill('[name="name"]',"موقع الواجهة",dialog);await submit(dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector('[role="tree"]')?.textContent.includes("موقع الواجهة"),"root create");check(true,"Location creation form");
    const newRoot=(await window.warehouse.warehouses.locations.list({warehouseId:q.w.id,search:"UI_ROOT"})).items[0];document.querySelector(`[data-tree-select="${newRoot.id}"]`).click();await wait(()=>document.querySelector('.location-details h3')?.textContent===newRoot.name,"created root details");await click("إضافة موقع فرعي");dialog=document.querySelector('[role="dialog"]');await fill('[name="code"]',"UI_CHILD",dialog);await fill('[name="name"]',"موقع فرعي",dialog);await submit(dialog);await wait(()=>!document.querySelector('[role="dialog"]'),"child creation");const newChild=(await window.warehouse.warehouses.locations.list({warehouseId:q.w.id,search:"UI_CHILD"})).items[0];check(newChild.parentId===newRoot.id,"Create-child form keeps selected parent");
    await fill('.search-field input',"UI_CHILD");await wait(()=>q.find("إظهار «موقع فرعي» في الشجرة"),"new child search");await click("إظهار «موقع فرعي» في الشجرة");await wait(()=>document.querySelector('.location-details h3')?.textContent===newChild.name,"new child details");await click("تعديل الموقع");dialog=document.querySelector('[role="dialog"]');await fill('[name="name"]',"موقع تنظيمي معدل",dialog);dialog.querySelector('input[type="checkbox"]').click();await submit(dialog);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector('.location-details').textContent.includes("موقع تنظيمي"),"stockability edit");check(true,"Metadata and stockability update through UI");
    await click("تعطيل الموقع");await click("تأكيد تغيير الحالة",document.querySelector('[role="dialog"]'));await wait(()=>!document.querySelector('[role="dialog"]')&&q.find("تفعيل الموقع"),"location deactivation");await click("تفعيل الموقع");await click("تأكيد تغيير الحالة",document.querySelector('[role="dialog"]'));await wait(()=>!document.querySelector('[role="dialog"]')&&q.find("تعطيل الموقع"),"location activation");check(true,"Location lifecycle confirmations");
    const defaultDetails=await window.warehouse.warehouses.warehouses.get({id:q.w.id});document.querySelector(`[data-tree-select="${defaultDetails.defaultLocation.id}"]`).click();await wait(()=>document.querySelector('.location-details h3')?.textContent===defaultDetails.defaultLocation.name,"default details");
    check(q.find("نقل الموقع داخل المخزن").disabled&&q.find("تعطيل الموقع").disabled,"Protected default movement and status actions disabled");await click("تعديل الموقع");dialog=document.querySelector('[role="dialog"]');check(dialog.querySelector('input[type="checkbox"]').disabled,"Default stockability protected");await click("إلغاء",dialog);
    check(document.documentElement.scrollWidth<=innerWidth,"Explorer has no horizontal page overflow at 1440px");
  }],
  ["inventory",async function(){
    const q=window.__qa,{wait,check,click,fill,route}=q,api=window.warehouse;
    await route("/inventory/operations","عمليات المخزون");await wait(()=>document.querySelectorAll('.inventory-entry select')[1].options.length>1,"eligible locations");
    const selects=()=>document.querySelectorAll('.inventory-entry select');
    check(Array.from(selects()[1].options).some(node=>node.textContent.includes(q.w.name)&&node.textContent.includes(q.root.name)),"Inventory labels show Warehouse and full path");
    const org=await api.warehouses.locations.create({warehouseId:q.w.id,code:"ORG",name:"تنظيمي فقط",locationType:"shelf",isStockable:false});
    await click("تحديث المواقع والمستندات");await wait(()=>!document.querySelector('fieldset').disabled,"refresh locations");check(!Array.from(selects()[1].options).some(node=>node.value===org.id),"Organizational location excluded from new stock operations");
    await fill('select',"receipt",document.querySelector('.inventory-entry label'));
    await fill('select',q.root.id,document.querySelectorAll('.inventory-entry label')[1]);await fill('select',q.item,document.querySelectorAll('.inventory-entry label')[2]);await fill('input',"10",document.querySelectorAll('.inventory-entry label')[3]);await click("إضافة سطر");await click("حفظ مسودة");await wait(()=>document.querySelectorAll('.inventory-documents tbody tr button').length>0,"receipt draft");
    let row=Array.from(document.querySelectorAll('.inventory-documents tbody tr')).find(node=>node.textContent.includes("استلام"));await click("اعتماد",row);await wait(()=>row.textContent.includes("معتمد"),"receipt posting");check(true,"Receipt posting through existing Inventory UI");
    await fill('select',"issue",document.querySelector('.inventory-entry label'));await fill('input',"2",document.querySelectorAll('.inventory-entry label')[3]);await click("إضافة سطر");await click("حفظ مسودة");await wait(()=>Array.from(document.querySelectorAll('.inventory-documents tbody tr')).some(node=>node.textContent.includes("صرف")),"issue draft");row=Array.from(document.querySelectorAll('.inventory-documents tbody tr')).find(node=>node.textContent.includes("صرف"));await click("اعتماد",row);await wait(()=>row.textContent.includes("معتمد"),"issue posting");check(true,"Issue posting through Inventory UI");
    await fill('select',"transfer",document.querySelector('.inventory-entry label'));await fill('select',q.child.id,document.querySelectorAll('.inventory-entry label')[2]);await fill('select',q.item,document.querySelectorAll('.inventory-entry label')[3]);await fill('input',"3",document.querySelectorAll('.inventory-entry label')[4]);await click("إضافة سطر");await click("حفظ مسودة");await wait(()=>Array.from(document.querySelectorAll('.inventory-documents tbody tr')).some(node=>node.textContent.includes("تحويل")),"transfer draft");row=Array.from(document.querySelectorAll('.inventory-documents tbody tr')).find(node=>node.textContent.includes("تحويل"));await click("اعتماد",row);await wait(()=>row.textContent.includes("معتمد"),"transfer posting");check(true,"Transfer source/destination remain functional");
    const decimal=(await api.catalog.products.create({name:"صنف عشري",sku:"UI_DECIMAL",productType:"simple",categoryId:q.product.categoryId,baseUnitId:q.product.baseUnitId,allowDecimalQuantity:true})).product;
    const decimalItem=(await api.inventory.execute({op:"items"})).rows.find(value=>value.id==="p:"+decimal.id).id;
    q.decimalItem=decimalItem;
    const decimalReceipt=await api.inventory.execute({op:"draft",kind:"receipt",lines:[{item:decimalItem,location:q.child.id,quantity:"1.125"}]});
    await api.inventory.execute({op:"post",document:decimalReceipt.id,version:1,command:"decimal-ui-precision"});await click("الأرصدة");
    await wait(()=>Array.from(document.querySelectorAll('fieldset > table tr')).some(value=>value.textContent.includes("UI_DECIMAL")&&value.textContent.includes("1.125")),"three-decimal quantity display");check(true,"Inventory displays exact three-decimal balances");
    q.unavailable=await api.warehouses.locations.create({warehouseId:q.w.id,code:"OLD",name:"موقع مسودة قديم",locationType:"bin"});
    q.historicalDraft=await api.inventory.execute({op:"draft",kind:"receipt",lines:[{item:q.item,location:q.unavailable.id,quantity:"1"}]});
  }],
  ["unavailable-draft-and-count",async function(){
    const q=window.__qa,{wait,check,click,fill}=q,api=window.warehouse;
    await click("تحديث المواقع والمستندات");await wait(()=>!document.querySelector('fieldset').disabled,"historical refresh");
    let row=Array.from(document.querySelectorAll('.inventory-documents tbody tr')).find(node=>node.textContent.includes(q.historicalDraft.id));await click("تعديل",row);await wait(()=>document.querySelector('.inventory-lines').textContent.includes("موقع مسودة قديم"),"draft historical label");
    check(document.querySelectorAll('.inventory-entry select')[1].value===q.unavailable.id,"Existing draft preserves unavailable selected location ID");check(document.querySelector('.inventory-lines').textContent.includes("غير متاح لعملية جديدة"),"Unavailable draft shows actual Warehouse/path");
    await click("حفظ التعديل");await wait(()=>document.querySelector('.inventory-feedback').textContent.includes("غير نشط"),"unavailable edit error");check(true,"Unavailable draft edit fails with actionable feedback");
    await click("اعتماد",row);await wait(()=>document.querySelector('.inventory-feedback').textContent.includes("غير نشط"),"unavailable post error");check(row.textContent.includes("مسودة"),"Rejected posting leaves original draft intact");
    await click("إغلاق تعديل المسودة");await click("إلغاء",row);await wait(()=>row.textContent.includes("ملغى"),"cancel unavailable draft");await click("تفاصيل",row);await wait(()=>document.querySelector('fieldset > table')?.textContent.includes("موقع مسودة قديم"),"historical label");check(document.querySelector('fieldset > table').textContent.includes("غير متاح لعملية جديدة"),"Unavailable historical locations retain names and paths");
    await fill('select',"count",document.querySelector('.inventory-entry label'));await fill('select',q.root.id,document.querySelectorAll('.inventory-entry label')[1]);check(document.querySelector('.inventory-page').textContent.includes("لا يشمل المواقع الفرعية"),"Inventory count explains exact-location scope");
    await click("بدء الجرد وقفل الموقع");await wait(()=>Array.from(document.querySelectorAll('.inventory-documents tbody tr')).some(node=>node.textContent.includes("جرد")),"start count");row=Array.from(document.querySelectorAll('.inventory-documents tbody tr')).find(node=>node.textContent.includes("جرد"));await click("تعديل",row);check(document.querySelectorAll('.inventory-entry select')[1].disabled,"Count edit preserves locked exact location");await fill('input',"6",document.querySelectorAll('.inventory-entry label')[3]);await click("إضافة سطر");await click("حفظ التعديل");await wait(()=>!q.find("إغلاق تعديل المسودة"),"save count actuals");await click("مراجعة",row);await wait(()=>row.textContent.includes("قيد المراجعة"),"review count");await click("اعتماد",row);await wait(()=>row.textContent.includes("معتمد"),"post count");check(true,"Count start/edit/review/post through UI");
    const issue=Array.from(document.querySelectorAll('.inventory-documents tbody tr')).find(node=>node.textContent.includes("صرف"));await click("عكس المستند",issue);await wait(()=>Array.from(document.querySelectorAll('.inventory-documents tbody tr')).some(node=>node.textContent.includes("عكس")&&!node.textContent.includes("عكس المستند")),"reversal");check(true,"Posted issue reversal through UI");
    check(!(await api.inventory.execute({op:"reconcile"})).rows.length,"Ledger/balance reconciliation after UI workflows");
  }],
  ["inventory-reports",async function(){
    const q=window.__qa,{wait,check,click,route}=q;
    const scope=new URLSearchParams({item:q.decimalItem,location:q.child.id});
    const report=()=>document.querySelector(".inventory-report");
    await route(`/inventory?${scope}`,"نظرة عامة على المخزون");
    await wait(()=>report()?.querySelectorAll(".inventory-quantity").length===2,"exact on-hand and available quantities");
    check(Array.from(report().querySelectorAll(".inventory-quantity")).every(cell=>cell.textContent==="1.125"),"Scoped overview uses the current ledger-backed quantities");
    await click("عرض الأرصدة");
    await wait(()=>report()?.querySelector("tbody")?.textContent.includes("1.125"),"exact location balance");
    check(report().querySelector("tbody").textContent.includes("UI_DECIMAL"),"Exact balance includes Catalog labels");
    await click("صنف عشري",report().querySelector("tbody"));
    await wait(()=>report()?.querySelector(".inventory-metrics .inventory-quantity")?.textContent==="1.125","stock item total");
    await route(`/inventory/warehouses?warehouse=${encodeURIComponent(q.w.id)}`,"المخزون حسب المخزن");
    await wait(()=>report()?.querySelectorAll("table").length===2,"warehouse totals and location balances");
    check(report().querySelector("tbody").textContent.includes("UI_DECIMAL"),"Warehouse report displays the posted item");
    check(report().querySelector("tbody").textContent.includes(q.product.name), "Warehouse report renders the full long product name");
    await route(`/inventory/history?${scope}`,"سجل حركات المخزون");
    await wait(()=>report()?.querySelector("tbody .inventory-quantity")?.textContent==="+1.125","signed movement history");
    await route(`/inventory/consistency?${scope}`,"التحقق من اتساق الرصيد");
    await click("تحقق من الاتساق");
    await wait(()=>report()?.querySelector(".notice-success"),"matching balance consistency");
    check(true,"All six Inventory query methods work through the rendered reports and real Preload");
  }],
  ["inventory-live-history", async function() {
    const { check, click, route, wait, decimalItem, child, root } = window.__qa;
    const api = window.warehouse.inventory;
    async function post(kind, location, command) {
      const draft = await api.execute({ op: "draft", kind, lines: [{ item: decimalItem, location, quantity: "0.001" }] });
      await api.execute({ op: "post", document: draft.id, version: 1, command });
    }
    const historyUrl = locationId => "/inventory/history?" + new URLSearchParams({ item: decimalItem, location: locationId });
    const ids = () => Array.from(document.querySelectorAll(".inventory-report tbody tr"), row => row.cells[0].textContent);
    await post("receipt", root.id, "qa-zero-receipt");
    await post("issue", root.id, "qa-zero-issue");
    const overview = location => "/inventory?" + new URLSearchParams({ item: decimalItem, location });
    await route(overview(root.id), "نظرة عامة على المخزون");
    const quantities = () => Array.from(document.querySelectorAll(".inventory-metrics .inventory-quantity"), node => node.textContent);
    await wait(() => quantities().join() === "0.000,0.000", "persisted zero");
    await route(overview(window.__qa.unavailable.id), "نظرة عامة على المخزون");
    await wait(() => document.querySelectorAll(".inventory-metrics dd")[0]?.textContent.includes("لا يوجد رصيد"), "missing balance");
    check(true, "Overview distinguishes a persisted zero from a missing balance at an inactive stockable location");

    for (let i = 0; i < 51; i++) await post("receipt", child.id, "qa-history-" + i);
    const expected = (await api.getInventoryHistory({ itemId: decimalItem, locationId: child.id, limit: 200 })).movements.map(row => row.movementId);
    const start = performance.now();
    await route(historyUrl(child.id), "سجل حركات المخزون");
    await wait(() => ids().length === 50, "50 rendered rows");
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__qa.historyPaintMs = Math.round(performance.now() - start);
    check(ids().join() === expected.slice(0, 50).join(), "History renders the first 50 movements in exact descending order");
    await post("receipt", child.id, "qa-history-live-insert");
    await click("التالي");
    await wait(() => ids().length === 2, "older history page");
    check(ids().join() === expected.slice(50).join(), "A concurrent newer posting does not duplicate or skip older movements");
    await click("السابق");
    await wait(() => ids().length === 50 && ids()[0] !== expected[0], "refreshed first page");
    check(ids().slice(1).join() === expected.slice(0, 49).join(), "Returning to page one includes the newer movement");
    location.hash = historyUrl(root.id);
    await wait(() => ids().length === 2, "changed history location");
    check(document.querySelector(".pagination button").disabled &&
      document.querySelector(".inventory-report tbody .inventory-quantity").textContent === "-0.001",
      "Changing the location resets the cursor and renders the signed issue");
    await route(historyUrl(child.id), "سجل حركات المخزون");
    await wait(() => ids().length === 50, "history for layout checks");
  }],
  ["inventory-discrepancy", async function() {
    const { check, click, route, wait, decimalItem, root } = window.__qa;
    const scope = { itemId: decimalItem, locationId: root.id };
    const inventory = window.warehouse.inventory;
    const history = await inventory.getInventoryHistory(scope);
    await route("/inventory/consistency?" + new URLSearchParams({ item: decimalItem, location: root.id }),
      "التحقق من اتساق الرصيد");
    await click("تحقق من الاتساق");
    await wait(() => document.querySelector(".inventory-report .notice-error")?.textContent.includes("يوجد اختلاف"),
      "deliberately inconsistent balance");
    const values = Array.from(document.querySelectorAll(".inventory-report .inventory-quantity"), node => node.textContent);
    check(values.join() === "9223372036854775.807,0.000", "Consistency report displays the exact 64-bit balance and ledger total");
    check((await inventory.getStockBalance(scope)).onHand === values[0] &&
      JSON.stringify(await inventory.getInventoryHistory(scope)) === JSON.stringify(history),
      "Consistency report leaves the stored balance and history untouched");
  }],
  ["permissions-and-routes",async function(){
    const q=window.__qa,{wait,check,click,fill,submit,route}=q;
    for(const [target,title] of [["/","مرحبًا بك في نظام إدارة المخازن"],["/products","الأصناف"],["/categories","التصنيفات"],["/units","وحدات القياس"],["/brands","العلامات التجارية"],["/variants","متغيرات الأصناف"],["/packaging","وحدات التعبئة"],["/barcodes","الباركود"]]){
      location.hash=target;await wait(()=>document.querySelector('.page-content h2')?.textContent.includes(title),"existing route "+target);check(true,"Existing route "+target);
    }
    await route("/products/new","إضافة صنف جديد");check(true,"Existing product creation route");await route(`/products/${q.product.id}/edit`,"تعديل الصنف");check(true,"Existing product edit route");await route(`/products/${q.product.id}`,q.product.name);check(true,"Existing product details route");
    await route("/branches","الفروع");await click("إضافة فرع");let stale=document.querySelector('[role="dialog"]');await fill('[name="code"]',"DENIED",stale);await fill('[name="name"]',"إجراء مرفوض",stale);
    await window.warehouse.identity.login({name:"ui-clerk",password:"test-password-456",setup:false});await submit(stale);await wait(()=>!document.querySelector('[role="dialog"]')&&document.querySelector('.notice-error')?.textContent.includes("لا تملك صلاحية"),"backend permission denial");check(!q.find("إضافة فرع"),"Backend denial refreshes stale UI capabilities");
    await click("تبديل المستخدم");await wait(()=>document.querySelector('.login-card button:not(:disabled)'),"login after denial");await fill('[name="name"]',"ui-admin");await fill('[name="password"]',"test-password-123");await submit(document.querySelector('.login-card form'));await wait(()=>document.querySelector('.side-nav'),"admin re-login");
    await route(`/warehouses/${q.w.id}/locations`,"مواقع التخزين");await click("تبديل المستخدم");await wait(()=>document.querySelector('.login-card button:not(:disabled)'),"switch clears UI");check(!document.querySelector('.warehouse-page'),"Privileged screens unmount before account switch");
    await fill('[name="name"]',"ui-clerk");await fill('[name="password"]',"test-password-456");await submit(document.querySelector('.login-card form'));await wait(()=>document.querySelector('.side-nav'),"clerk login");
    await route("/branches","الفروع");check(!q.find("إضافة فرع")&&!q.find("تعديل")&&!q.find("تعطيل"),"Clerk sees read-only Branch screen");
    await route(`/warehouses/${q.w.id}`,q.w.name);check(!q.find("تعديل المخزن")&&!q.find("نقل تبعية الفرع")&&!q.find("تعطيل المخزن"),"Clerk sensitive Warehouse controls revoked");
    await route(`/warehouses/${q.w.id}/locations`,"مواقع التخزين");check(!q.find("إضافة موقع جذري"),"Clerk cannot create locations after switching");
  }],
];
app.once("browser-window-created",(_event,win)=>{
  win.webContents.once("did-finish-load",async()=>{
    try {
      for(const [name,step] of steps){
        await win.webContents.executeJavaScript(`(${step.toString()})()`);
        console.log("Warehouse UI step passed",name);
        if(["branches","locations"].includes(name))fs.writeFileSync(path.resolve("out",`${evidencePrefix}-${name}.png`),(await win.webContents.capturePage()).toPNG());
        if(name==="branches"){
          await win.webContents.executeJavaScript("window.__qa.click('إضافة فرع')");
          fs.writeFileSync(path.resolve("out",`${evidencePrefix}-dialog.png`),(await win.webContents.capturePage()).toPNG());
          await win.webContents.executeJavaScript(`(async()=>{const q=window.__qa,dialog=document.querySelector('[role="dialog"]'),nodes=dialog.querySelectorAll('button'),last=nodes[nodes.length-1];last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));q.check(document.activeElement===dialog.querySelector('input'),'Dialog traps keyboard focus');dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await q.wait(()=>!document.querySelector('[role="dialog"]'),'Escape closes dialog');q.check(true,'Dialog supports keyboard dismissal');})()`);
        }
        if(name==="locations"){
          win.setSize(1100,700);await new Promise(resolve=>setTimeout(resolve,100));
          await win.webContents.executeJavaScript("window.__qa.check(document.documentElement.scrollWidth<=innerWidth,'No horizontal page overflow at minimum desktop width')");
          fs.writeFileSync(path.resolve("out",`${evidencePrefix}-locations-1100.png`),(await win.webContents.capturePage()).toPNG());
          await win.webContents.executeJavaScript(`(async()=>{const q=window.__qa;await q.click('إضافة موقع جذري');const box=document.querySelector('[role="dialog"]').getBoundingClientRect();q.check(box.width<=innerWidth&&box.height<=innerHeight-40,'Location dialog fits the minimum supported desktop size');})()`);
          fs.writeFileSync(path.resolve("out",`${evidencePrefix}-dialog-1100.png`),(await win.webContents.capturePage()).toPNG());
          await win.webContents.executeJavaScript("window.__qa.click('إلغاء',document.querySelector('[role=dialog]'))");win.setSize(1440,900);
        }
        if(name==="inventory"){
          // Controlled adverse-state fixture only in this runner's fresh disposable DB.
          // Production services intentionally prevent deactivation with pending work.
          if(fs.existsSync(path.join(profile,"active-dataset")))throw Error("Expected fresh QA dataset");
          const id=await win.webContents.executeJavaScript("window.__qa.unavailable.id");
          const fixturePath=path.resolve(profile,"warehouse.sqlite");
          if(path.dirname(fixturePath)!==path.resolve(profile))throw Error("Invalid fixture path");
          const fixture=new (require("better-sqlite3"))(fixturePath,{fileMustExist:true});
          try {
            fixture.pragma("foreign_keys=ON");
            if(fixture.prepare("UPDATE locations SET status='inactive',version=version+1 WHERE id=? AND code='OLD'").run(id).changes!==1)throw Error("Missing adverse-state fixture");
            if(fixture.pragma("integrity_check",{simple:true})!=="ok"||fixture.pragma("foreign_key_check").length)throw Error("Invalid fixture database");
          }finally{fixture.close();}
        }
        if (name === "inventory-live-history") {
          const historyPaintMs = await win.webContents.executeJavaScript("window.__qa.historyPaintMs");
          console.log("Inventory history navigation and paint (ms)", historyPaintMs);
          win.setSize(1100, 700);
          await win.webContents.executeJavaScript(`(async () => {
            const { check, wait } = window.__qa;
            const report = document.querySelector(".inventory-report");
            await wait(() => innerWidth <= 1100, "minimum window width");
            check(getComputedStyle(report).direction === "rtl" && document.documentElement.scrollWidth <= innerWidth,
              "Arabic Inventory history fits the minimum desktop width");
            check(document.querySelector(".table-wrap").getBoundingClientRect().height > innerHeight &&
              document.scrollingElement.scrollHeight > innerHeight, "A full history page can scroll");
            document.querySelector(".inventory-nav a").focus();
          })()`);
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await win.webContents.executeJavaScript(`(async () => {
            const { check, wait } = window.__qa;
            const next = document.querySelectorAll(".inventory-nav a")[1];
            await wait(() => document.activeElement === next, "Tab advances within Inventory navigation");
            check(next.matches(":focus-visible") && getComputedStyle(next).outlineStyle !== "none",
              "Tab advances within Inventory navigation and keeps a visible outline");
          })()`);
          fs.writeFileSync(path.resolve("out", `${evidencePrefix}-inventory-history-1100.png`),
            (await win.webContents.capturePage()).toPNG());
          win.setSize(1440, 900);
          const scope = await win.webContents.executeJavaScript("({ item: window.__qa.decimalItem, location: window.__qa.root.id })");
          const fixture = new (require("better-sqlite3"))(path.join(profile, "warehouse.sqlite"), { fileMustExist: true });
          try {
            fixture.pragma("foreign_keys=ON");
            if (fixture.prepare("UPDATE balances SET qty=? WHERE item=? AND location=? AND qty=0")
              .run(9223372036854775807n, scope.item, scope.location).changes !== 1) throw Error("Missing zero-balance fixture");
          } finally {
            fixture.close();
          }
        }
        if (name === "inventory-discrepancy") {
          fs.writeFileSync(path.resolve("out", `${evidencePrefix}-inventory-consistency.png`),
            (await win.webContents.capturePage()).toPNG());
        }
      }
      const checks=await win.webContents.executeJavaScript("window.__qa.checks");
      fs.writeFileSync(path.resolve("out",`${evidencePrefix}-ui-checks.json`),JSON.stringify(checks,null,2)+"\n");
      console.log("Warehouse UI smoke passed",JSON.stringify({checks:checks.length}));clearTimeout(deadline);app.quit();
    }catch(error){console.error(error);clearTimeout(deadline);app.exit(1);}
  });
});
require(path.resolve("out/main/index.js"));
