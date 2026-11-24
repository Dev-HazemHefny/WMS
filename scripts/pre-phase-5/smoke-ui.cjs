const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { workspace, toolsDirectory } = require("./profile.cjs");
const { seedProfile, seedAccounts } = require(path.join(toolsDirectory, "seed.cjs"));

const profile = process.env.WMS_QA_PROFILE;
const phase = process.env.WMS_QA_PHASE;
const database = profile && path.join(profile, "warehouse.sqlite");
if (!profile || path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) ||
    !/^warehouse-desktop-test-[a-z0-9]+$/i.test(path.basename(profile)) ||
    !["fresh", "restart"].includes(phase)) throw new Error("A disposable QA profile is required");

app.setPath("userData", profile);
app.disableHardwareAcceleration();
const deadline = setTimeout(() => {
  console.error("Seeded UI timed out");
  app.exit(1);
}, 55000);

async function verifyRenderer(account, phase) {
  const api = window.warehouse;
  async function wait(fn, label) {
    const until = Date.now() + 7000;
    while (Date.now() < until) {
      const result = fn();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${label}. ${document.body.innerText.slice(-1200)}`);
  }
  const select = selector => document.querySelector(selector);
  const rows = () => Array.from(document.querySelectorAll("tbody tr"));
  const row = value => rows().find(node => node.textContent.includes(value));
  const text = (selector, value) => select(selector)?.textContent.includes(value);
  const click = async (label, scope = document) => {
    const control = await wait(() => Array.from(scope.querySelectorAll("a,button"))
      .find(node => !node.disabled && node.textContent.trim() === label), label);
    control.click();
  };
  const fill = (selector, value) => {
    const element = select(selector);
    if (!element) throw new Error(`Missing field ${selector}`);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const show = async (route, selector, value) => {
    location.hash = route;
    await wait(() => text(selector, value), `${route} showing ${value}`);
  };
  const search = value => fill('input[placeholder="اسم الصنف أو الكود"]', value);
  const saveProduct = async () => {
    const form = select(".product-form");
    if (!form.checkValidity()) {
      const invalid = Array.from(form.querySelectorAll(":invalid"), field => field.name || field.tagName);
      throw new Error(`Product editor has invalid fields: ${invalid.join(", ")}`);
    }
    await click("حفظ الصنف", form);
  };
  const checked = [];

  await wait(() => select(".login-card button:not(:disabled)"), "seeded login screen");
  fill('[name="name"]', account.name);
  fill('[name="password"]', account.password);
  select(".login-card form").requestSubmit();
  await wait(() => select(".side-nav"), "dashboard after login");

  if (phase === "fresh") {
    await show("/products", ".page-title h2", "الأصناف");
    await wait(() => rows().length === 20, "first 20 products");
    await click("التالي");
    await wait(() => text(".pagination", "2") && rows().length === 20, "second product page");
    await click("التالي");
    await wait(() => rows().length === 4, "last four products");
    fill('.filters select:has(option[value="with_variants"])', "with_variants");
    await wait(() => row("DEMO-USB-C") && row("DEMO-BOLT") && rows().length === 4, "four variant families");
    await click("Braided USB-C Cable", row("DEMO-USB-C"));
    await wait(() => text(".page-title h2", "Braided USB-C Cable") && document.body.innerText.includes("DEMO-USB-C-3"), "variant detail");
    checked.push("Product pagination, variant filter and seeded variant details");

    for (const [route, expected] of [
      ["/categories", "Electronics"], ["/brands", "Delta Circuit"], ["/units", "Kilogram"],
      ["/variants", "DEMO-"], ["/packaging", "Pack"], ["/barcodes", "29"],
      ["/branches", "Alexandria Branch"], ["/warehouses", "Central Warehouse"],
    ]) {
      await show(route, ".page-content", expected);
      checked.push(`Seeded rows on ${route}`);
    }

    await show("/products", ".page-title h2", "الأصناف");
    search("nonexistent-demo-product");
    await wait(() => text(".state-card", "لا توجد أصناف مطابقة"), "empty product search");
    search("DEMO-RICE");
    await wait(() => row("DEMO-RICE") && rows().length === 1, "SKU search");
    const rice = (await api.catalog.products.list({ search: "DEMO-RICE" })).items[0];
    const source = await api.catalog.products.get({ id: rice.id });
    await show("/barcodes", ".page-title h2", "الباركود");
    fill(".lookup-bar input", source.barcodes[0].code);
    select(".lookup-bar").requestSubmit();
    await wait(() => text(".lookup-result", "DEMO-RICE"), "seeded barcode lookup");
    await click("تجهيز ملصق");
    await wait(() => text(".barcode-label", source.barcodes[0].code), "barcode label preview");
    checked.push("Seeded barcode lookup and text label preview");
    await show("/products", ".page-title h2", "الأصناف");
    await click("إضافة صنف");
    await wait(() => select('select[name="baseUnitId"] option[value]:not([value=""])'), "editor references");
    fill('.product-form [name="name"]', "Seed QA Pencil");
    fill('.product-form [name="sku"]', "DEMO-RICE");
    fill('.product-form [name="categoryId"]', source.product.categoryId);
    fill('.product-form [name="baseUnitId"]', source.product.baseUnitId);
    await saveProduct();
    await wait(() => text(".product-form .notice-error", "DEMO-RICE"), "duplicate SKU validation");
    fill('.product-form [name="sku"]', "QA-SEED-PENCIL");
    await saveProduct();
    await wait(() => text(".page-title h2", "Seed QA Pencil"), "created product details");
    const created = (await api.catalog.products.list({ search: "QA-SEED-PENCIL" })).items[0];
    await show(`/products/${created.id}/edit`, ".page-title h2", "تعديل الصنف");
    fill('.product-form [name="name"]', "Seed QA Pencil Updated");
    await saveProduct();
    await wait(() => text(".page-title h2", "Seed QA Pencil Updated"), "updated product details");
    await show("/products", ".page-title h2", "الأصناف");
    search("QA-SEED-PENCIL");
    const createdRow = await wait(() => row("QA-SEED-PENCIL"), "search for changed product");
    await click("تعطيل", createdRow);
    await wait(() => row("QA-SEED-PENCIL")?.textContent.includes("غير نشط"), "deactivated product");
    await click("تفعيل", row("QA-SEED-PENCIL"));
    await wait(() => row("QA-SEED-PENCIL") && !row("QA-SEED-PENCIL").textContent.includes("غير نشط"), "reactivated product");
    await click("تعطيل", row("QA-SEED-PENCIL"));
    await wait(() => row("QA-SEED-PENCIL")?.textContent.includes("غير نشط"), "inactive product for restart");
    checked.push("Product empty state, SKU search, duplicate SKU validation, create, update, deactivate and reactivate");
  } else {
    await show("/products", ".page-title h2", "الأصناف");
    search("QA-SEED-PENCIL");
    await wait(() => row("QA-SEED-PENCIL")?.textContent.includes("Seed QA Pencil Updated") &&
      row("QA-SEED-PENCIL")?.textContent.includes("غير نشط"), "persisted edit and activation state");
    checked.push("Product name and inactive state survived a full Electron restart");
  }

  const central = (await api.warehouses.warehouses.list({ search: "DEMO-CENTRAL" })).items[0];
  if (phase === "fresh") {
    await show(`/warehouses/${central.id}`, ".page-title h2", "Central Warehouse");
    await wait(() => text(".warehouse-metadata", "Main Branch"), "warehouse branch relationship");
    await show(`/warehouses/${central.id}/locations`, ".page-title h2", "مواقع التخزين");
    for (const name of ["Storage Zone A", "Shelf A-01"]) {
      const control = await wait(() => Array.from(document.querySelectorAll(".tree-expander"))
        .find(node => !node.disabled && node.getAttribute("aria-label")?.includes(name)), `expand ${name}`);
      control.click();
    }
    await wait(() => text('[role="tree"]', "Bin A-01-02"), "seeded Bin A-01-02");
    checked.push("Seeded warehouse owner and expanded zone, shelf and bin");
  }
  const places = (await api.inventory.execute({ op: "places" })).rows;
  const bin = places.find(place => place.warehouse_id === central.id && place.path.endsWith("Bin A-01-02"));
  const stockItems = (await api.inventory.execute({ op: "items" })).rows;
  const item = sku => stockItems.find(stockItem => stockItem.sku === sku).id;
  const scope = new URLSearchParams({ item: item("DEMO-RICE"), location: bin.id });
  await show(`/inventory?${scope}`, ".inventory-metrics", "125.375");
  await show(`/inventory/balances?${scope}`, ".inventory-report tbody", "125.375");
  await show(`/inventory/items?${scope}`, ".inventory-metrics", "176.000");
  await show(`/inventory/warehouses?warehouse=${central.id}`, ".inventory-report tbody", "DEMO-RICE");
  await show(`/inventory/history?${scope}`, ".inventory-report tbody", "+125.375");
  await show(`/inventory/consistency?${scope}`, ".page-title h2", "التحقق من اتساق الرصيد");
  await click("تحقق من الاتساق");
  await wait(() => select(".inventory-report .notice-success"), "seeded ledger reconciliation");
  const office = places.find(place => place.warehouse_id === central.id && place.path.endsWith("Bin A-01-04"));
  const officeScope = sku => new URLSearchParams({ item: item(sku), location: office.id });
  await show(`/inventory?${officeScope("DEMO-PAPER")}`, ".inventory-metrics", "0.000");
  await show(`/inventory?${officeScope("DEMO-ENVELOPE")}`, ".inventory-metrics", "لا يوجد رصيد");
  checked.push("Inventory overview, balances, item total, warehouse report, history, reconciliation, zero and missing balance");
  return checked;
}

async function start() {
  if (phase === "fresh") {
    if (fs.readdirSync(profile).length) throw new Error("Expected a fresh disposable QA profile");
    await seedProfile(profile);
  } else if (!fs.statSync(database).isFile()) throw new Error("Missing restart fixture");

  app.once("browser-window-created", (_event, win) => {
    win.webContents.once("did-finish-load", async () => {
      try {
        const checks = await win.webContents.executeJavaScript(
          `(${verifyRenderer.toString()})(${JSON.stringify(seedAccounts.admin)}, ${JSON.stringify(phase)})`,
        );
        console.log("Seeded UI smoke passed", JSON.stringify({ phase, checks }));
        clearTimeout(deadline);
        app.quit();
      } catch (error) {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
      }
    });
  });
  require(path.join(workspace, "out/main/index.js"));
}

start().catch(error => {
  console.error(error);
  clearTimeout(deadline);
  app.exit(1);
});
