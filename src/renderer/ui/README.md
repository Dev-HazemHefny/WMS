# Renderer design system

The renderer UI is built from a small set of shared primitives so every screen
looks and behaves the same.

## Structure

- `tokens` live in `src/renderer/styles.css` under `:root` (colors, radii,
  shadows, font sizes). Use the `--color-*`, `--radius-*`, `--shadow-*` and
  `--font-size-*` variables instead of new literals.
- `primitives.tsx` – `PageTitle`, `Button`, `Notice`, `StatusBadge`,
  `LoadingState`, `EmptyState`.
- `patterns.tsx` – `FilterBar`, `SearchField`, `StatusSelect`,
  `SearchStatusFilter`, `DataTable`, `ListPagination`, `Dialog`.
- `labels.ts` – Arabic labels for catalog enums.
- `feedback.ts` – `errorMessage` and `confirmDelete`.

Import everything from `src/renderer/ui`:

```tsx
import { Button, DataTable, PageTitle } from "../ui";
```

`src/renderer/shared/ui.tsx` re-exports the same module for backwards
compatibility.

## Adding a list page

1. Load the page into local state (`Page<T> | null`).
2. Render `<SearchStatusFilter ... />` for the common filters.
3. Render `<DataTable loading rows rowKey empty columns />`.
4. Render `<ListPagination />` when a page is available.

This keeps loading, empty, error and action layouts consistent without
repeating table / dialog markup in each page.
