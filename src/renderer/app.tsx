import { InventoryPage } from "./inventory-page";
import { BarcodesPage, PackagingPage, VariantsPage } from "./catalog/operations-pages";
import { ProductDetailsPage, ProductFormPage, ProductsPage } from "./catalog/product-pages";
import { BrandsPage, CategoriesPage, UnitsPage } from "./catalog/reference-pages";
import { BranchesPage } from "./warehouses/branch-pages";
import { WarehousesPage, WarehouseDetailsPage } from "./warehouses/warehouse-pages";
import { LocationExplorer } from "./warehouses/location-explorer";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./app-layout";
import { DashboardPage } from "./dashboard-page";

export function App() {
  return <HashRouter>
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route path="warehouses" element={<WarehousesPage />} />
        <Route path="warehouses/:id" element={<WarehouseDetailsPage />} />
        <Route path="warehouses/:id/locations" element={<LocationExplorer />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductFormPage />} />
        <Route path="products/:id/edit" element={<ProductFormPage />} />
        <Route path="products/:id" element={<ProductDetailsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="units" element={<UnitsPage />} />
        <Route path="brands" element={<BrandsPage />} />
        <Route path="variants" element={<VariantsPage />} />
        <Route path="packaging" element={<PackagingPage />} />
        <Route path="barcodes" element={<BarcodesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </HashRouter>;
}
