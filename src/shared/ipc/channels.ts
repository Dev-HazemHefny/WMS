export const IPC_CHANNELS = {
  system: {
    getAppInfo: "system:get-app-info"
  },
  catalog: {
    categories: {
      list: "catalog:categories:list",
      lookup: "catalog:categories:lookup",
      tree: "catalog:categories:tree",
      create: "catalog:categories:create",
      update: "catalog:categories:update",
      activate: "catalog:categories:activate",
      deactivate: "catalog:categories:deactivate",
      delete: "catalog:categories:delete"
    },
    units: {
      list: "catalog:units:list",
      lookup: "catalog:units:lookup",
      create: "catalog:units:create",
      update: "catalog:units:update",
      activate: "catalog:units:activate",
      deactivate: "catalog:units:deactivate",
      delete: "catalog:units:delete"
    },
    brands: {
      list: "catalog:brands:list",
      lookup: "catalog:brands:lookup",
      create: "catalog:brands:create",
      update: "catalog:brands:update",
      activate: "catalog:brands:activate",
      deactivate: "catalog:brands:deactivate",
      delete: "catalog:brands:delete"
    },
    products: {
      list: "catalog:products:list",
      lookup: "catalog:products:lookup",
      get: "catalog:products:get",
      create: "catalog:products:create",
      update: "catalog:products:update",
      activate: "catalog:products:activate",
      deactivate: "catalog:products:deactivate",
      delete: "catalog:products:delete"
    },
    variants: {
      list: "catalog:variants:list",
      get: "catalog:variants:get",
      create: "catalog:variants:create",
      update: "catalog:variants:update",
      activate: "catalog:variants:activate",
      deactivate: "catalog:variants:deactivate",
      delete: "catalog:variants:delete"
    },
    packaging: {
      list: "catalog:packaging:list",
      add: "catalog:packaging:add",
      update: "catalog:packaging:update",
      activate: "catalog:packaging:activate",
      deactivate: "catalog:packaging:deactivate",
      delete: "catalog:packaging:delete"
    },
    barcodes: {
      list: "catalog:barcodes:list",
      add: "catalog:barcodes:add",
      delete: "catalog:barcodes:delete",
      find: "catalog:barcodes:find",
      label: "catalog:barcodes:label"
    },
    media: {
      read: "catalog:media:read"
    }
  }
} as const;