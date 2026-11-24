# Warehouse Management System (WMS)
## Product Requirements Document (PRD) & System Design Specification

**Version:** 2.0
**Document Status:** Architecture V2
**Application Type:** Offline Desktop Application  
**Target Platform:** Windows  
**Architecture:** Modular Monolith  
**Database:** SQLite  
**Primary Language:** TypeScript

---

# 1. Project Overview

## 1.1 Product Vision

تطوير نظام Warehouse Management System مرن وقابل للتوسع، يساعد الشركات على إدارة الأصناف والمخازن والأرصدة وحركات المخزون من خلال تطبيق Desktop يعمل محليًا دون الحاجة إلى اتصال بالإنترنت.

يستهدف النظام أنشطة تجارية وصناعية ولوجستية مختلفة، مع إمكانية تخصيص خصائصه وفقًا لطبيعة كل شركة.

سيتم تطوير النظام على هيئة Modular Application، بحيث تكون الوظائف الأساسية جزءًا من المنتج، ويمكن إضافة Business Modules وAdvanced Features مستقبلًا دون الحاجة إلى إعادة بناء النظام بالكامل.

## 1.2 Product Objectives

1. إدارة بيانات الأصناف والمنتجات ووحدات القياس.
2. إدارة الفروع والمخازن وأماكن التخزين.
3. متابعة أرصدة المخزون بصورة دقيقة.
4. تسجيل جميع العمليات التي تؤثر على المخزون.
5. إدارة المستخدمين والأدوار والصلاحيات.
6. توفير إعدادات مرنة لتخصيص النظام.
7. دعم العمل Offline بالكامل.
8. توفير بنية قابلة للتوسع وإضافة موديولات مستقبلية.
9. الحفاظ على سلامة البيانات وسجل العمليات.
10. تجهيز البنية لإضافة التكلفة والتقييم والمحاسبة مستقبلًا.

## 1.3 Target Users

- أصحاب الشركات.
- مديرو المخازن.
- أمناء المخازن.
- موظفو الاستلام والصرف.
- مسؤولو النظام.
- الموظفون المسؤولون عن الجرد ومتابعة المخزون.

## 1.4 Target Business Types

يستهدف النظام إمكانية الاستخدام في:

- الشركات التجارية.
- شركات التوزيع.
- المصانع.
- شركات الخدمات اللوجستية.
- الشركات التي تمتلك عدة فروع ومخازن.

---

# 2. Product Scope

شركة واحدة لكل قاعدة بيانات محلية. يعمل المستخدمون بالتبادل على جهاز واحد، ويمكن للمستخدم امتلاك عدة أدوار. يتبع كل مخزن فرعًا واحدًا.

## 2.1 Version 1.0 – Core Modules

تتكون النسخة الأولى من ستة Core Modules:

1. Product & Item Management.
2. Warehouses & Storage Locations.
3. Inventory Management.
4. Stock Operations.
5. Users, Roles & Permissions.
6. System Settings.

## 2.2 Future Optional Business Modules

الموديولات التالية ليست ضمن نطاق التنفيذ الأول، ولكن يجب أن تسمح البنية بإضافتها مستقبلًا:

- Suppliers & Customers Management.
- Purchase Management.
- Sales Management.
- Advanced Barcode Operations.
- Batch / Serial / Expiry Tracking.
- Reorder & Inventory Alerts.
- Reports & Analytics.
- Costing & Inventory Valuation.
- Accounting Integration.

## 2.3 Modularity Principles

يعتمد النظام على المبادئ التالية:

- Modularity: فصل الوظائف إلى وحدات مستقلة نسبيًا.
- Configurability: إمكانية تخصيص النظام من خلال الإعدادات.
- Extensibility: إمكانية إضافة وظائف مستقبلية.
- Backward Compatibility: الحفاظ على توافق البيانات والإصدارات.
- Feature Isolation: عدم السماح للموديولات بالتداخل العشوائي.
- Permission Isolation: فصل تفعيل الموديول عن صلاحيات المستخدمين.

**قاعدة مهمة:** تفعيل Module لا يعني منح جميع المستخدمين صلاحية استخدامه.

## 2.4 Product Configuration

سيتم توفير إعدادات جاهزة يختار منها العميل الخصائص المناسبة لنشاطه.

يجب أن تكون إعدادات النظام منفصلة عن Business Logic، وألا يؤدي تغيير إعداد إلى الإضرار بالبيانات أو تاريخ الحركات.

---

# 3. Technology Stack

## 3.1 Desktop Application

- Electron.
- Windows Installer باستخدام NSIS.

## 3.2 Frontend

- React 18.
- React Router.
- Redux Toolkit.
- React Redux.
- Vite.
- Tailwind CSS.
- PostCSS.
- Autoprefixer.
- Framer Motion.
- Lucide React.

## 3.3 Backend & Local Data

- Electron Main Process.
- SQLite.
- better-sqlite3.

## 3.4 Utilities

- jsPDF.
- jspdf-autotable.
- xlsx.
- Fuse.js.

## 3.5 Testing & Development Tools

- Jest.
- Babel.
- ESLint.
- TypeScript.
- Docker Compose لأغراض التطوير أو عمليات البناء عند الحاجة.

**ملاحظة:** TypeScript موجود ضمن التوجه المعماري المقترح، ويجب اعتماده فعليًا في الكود بدل الاكتفاء بوجود إعداداته مع كتابة المشروع باستخدام JavaScript.

---

# 4. Architecture Overview

## 4.1 Architecture Style

سيعتمد النظام على:

**Modular Monolith Architecture + Layered Architecture + Clean Architecture Principles**

الهدف هو تطوير تطبيق واحد متكامل، مع تقسيم داخلي واضح للموديولات والطبقات.

لن يتم استخدام Microservices في الإصدار الأول؛ لأن طبيعة التطبيق المحلي لا تتطلب هذا التعقيد.

## 4.2 Application Processes

يتكون التطبيق من ثلاثة أجزاء أساسية:

### A. Electron Main Process

المسؤول عن:

- تشغيل التطبيق وإدارة دورة حياته.
- تهيئة قاعدة البيانات.
- إدارة اتصالات قاعدة البيانات.
- تسجيل IPC Handlers.
- تشغيل Application Services.
- التعامل مع الملفات والموارد المحلية.
- تنفيذ العمليات التي تحتاج إلى صلاحيات نظام التشغيل.

### B. React Renderer Process

المسؤول عن:

- واجهة المستخدم.
- عرض البيانات.
- إدارة الصفحات والتنقل.
- إدارة حالة الواجهة.
- استقبال مدخلات المستخدم.
- التواصل مع Electron من خلال Preload API.

يجب ألا يمتلك Renderer وصولًا مباشرًا إلى قاعدة البيانات أو واجهات Node.js.

### C. Preload Script

المسؤول عن توفير واجهة اتصال محددة وآمنة بين Renderer وMain Process.

يجب أن تكون الواجهة محدودة بالوظائف المسموح بها، وألا تسمح بتنفيذ IPC عشوائي من الواجهة.

## 4.3 Layered Architecture

### 1. Presentation Layer

التقنيات:

- React.
- React Router.
- Redux Toolkit.
- Tailwind CSS.

المسؤوليات:

- عرض البيانات.
- Forms.
- Pages.
- Components.
- Client-side State.
- Form Validation.
- إرسال طلبات العمليات من خلال API الواجهة المحلية.

لا تحتوي هذه الطبقة على قواعد Business Logic الخاصة بالمخزون.

### 2. Application Layer

المسؤوليات:

- تنفيذ Use Cases.
- تنسيق العمليات.
- استدعاء Domain Logic.
- إدارة سير العمليات.
- التعامل مع DTOs.
- تنسيق المعاملات المطلوبة من خلال واجهات البنية التحتية.

أمثلة:

- CreateProduct.
- UpdateProduct.
- CreateWarehouse.
- ReceiveStock.
- IssueStock.
- TransferStock.
- AdjustInventory.

### 3. Domain Layer

المسؤوليات:

- Entities.
- Value Objects.
- Business Rules.
- Domain Services.
- Domain Events عند الحاجة.

يجب أن تكون مستقلة عن:

- React.
- Electron.
- SQLite.
- better-sqlite3.

هذه الطبقة تحتوي على القواعد الأساسية التي تحدد صحة العمليات.

### 4. Infrastructure Layer

المسؤوليات:

- SQLite Database.
- Repository Implementations.
- Database Migrations.
- File Storage.
- Database Transactions.
- Logging.
- Backup & Restore.

هذه الطبقة تنفذ التفاصيل التقنية التي تعتمد عليها Application Layer.

## 4.4 Dependency Direction

يجب أن تتجه الاعتمادات إلى الداخل:

Presentation → Application → Domain

Infrastructure تنفذ الواجهات التي تحتاج إليها الطبقات الداخلية.

لا يجب أن تعتمد Domain على Infrastructure أو Electron أو React.

## 4.5 Recommended Architecture

التوجه المقترح هو **Option B: Independent Application Core**.

يتم فصل Domain وApplication عن Electron، ويكون Electron Main مجرد Host وAdapter لتشغيل النظام وربط IPC بالـ Application Core.

الفوائد:

- سهولة اختبار Business Logic.
- تقليل الارتباط بإطار Desktop.
- إمكانية إعادة استخدام الـ Core في تطبيق Web أو API مستقبلًا.
- سهولة استبدال تفاصيل التخزين مستقبلًا.

---

# 5. Module Architecture

## 5.1 Product & Item Management

المسؤول عن تعريف وإدارة المنتجات والأصناف.

يشمل:

- Products.
- Product Categories.
- Product Variants.
- Units of Measurement.
- Packaging Units.
- Brands.
- Barcodes.
- Product-Supplier Relationships.

### Business Requirements

#### Product Definition

بيانات الصنف تشمل:

- Name.
- SKU.
- Barcode.
- Category.
- Base Unit.
- Description.
- Image.
- Status: Active / Inactive.
- Brand (Optional).

يجب أن يكون SKU فريدًا داخل نطاق الشركة.

الصنف يمكن تسجيله دون وجود أي رصيد مخزني.

#### Categories

- دعم Hierarchical Categories.
- دعم مستويات فرعية متعددة.
- كل صنف يرتبط بتصنيف أساسي واحد في الإصدار الأول.
- تعطيل التصنيف بدل حذفه إذا كانت هناك أصناف مرتبطة به.
- منع حذف التصنيفات التي لها ارتباطات تاريخية.

#### Product Types

يدعم النظام نوعين:

1. Simple Product: صنف بدون Variants.
2. Product With Variants: منتج يحتوي على عدة متغيرات.

#### Product Variants

مثال:

Product: Cotton T-Shirt

Variants:

- Red / M.
- Red / L.
- Black / M.
- Black / L.

كل Variant يجب أن يمتلك:

- SKU مستقل.
- Barcode أو أكثر.
- رصيد مستقل.
- بيانات الوحدة والتعبئة المناسبة له.

يجب أن تكون حركات المخزون مرتبطة بالـ Variant عندما يكون المنتج من النوع المتغير.

لا يسمح بالخلط بين المخزون المباشر للمنتج ومخزون متغيراته.

#### Units of Measurement

- كل صنف له Base Unit واحدة.
- يمكن تعريف وحدات إضافية للصنف.
- لكل وحدة إضافية Conversion Factor.
- عوامل التحويل مرتبطة بالصنف أو المتغير، وليست قيمة عامة لجميع الأصناف.
- منع التحويل بين وحدات غير متوافقة.
- تخزين رصيد المخزون باستخدام الوحدة الأساسية.
- الاحتفاظ بوحدة الإدخال المستخدمة في مستند الحركة.

مثال:

- Piece = 1.
- Pack = 6.
- Carton = 12.

#### Quantity Precision

تُقبل الكميات حتى ثلاث منازل عشرية. التخزين بأجزاء الألف، والتحويل بعوامل كسرية دقيقة. يُرفض التقريب أو تجاوز نطاق العدد الصحيح.

يدعم النظام:

- Whole Quantities.
- Decimal Quantities.

كل صنف يحدد ما إذا كان يسمح بالكميات الكسرية.

أمثلة:

- 10 Pieces.
- 2.5 Kilograms.
- 1.75 Liters.
- 3.5 Meters.

يجب الحفاظ على الدقة عند التحويل بين الوحدات وعدم استخدام تقريب عشوائي يؤثر على الأرصدة.

#### Brands

- إدارة العلامات التجارية ككيان مستقل.
- الاسم.
- الكود.
- الوصف.
- الصورة أو الشعار اختياري.
- ربط الصنف ببراند اختياري.
- دعم البحث والتصفية.
- تعطيل البراند بدل حذف البيانات المرتبطة.

#### Barcodes

- دعم أكثر من Barcode للصنف.
- إمكانية ربط Barcode بوحدة تعبئة محددة.
- إدخال يدوي أو باستخدام Scanner.
- البحث بالباركود.
- طباعة Barcode Labels.
- يجب أن يكون الباركود فريدًا ضمن نطاق الشركة.

#### Supplier Relationship

يدعم النظام علاقة Many-to-Many بين الأصناف والموردين مستقبلًا.

لكل علاقة يمكن تسجيل:

- Supplier Product Code.
- Purchase Price.
- Notes.
- Status.

إدارة المشتريات والفواتير والاستلام التجاري ليست ضمن مسؤولية هذا الموديول في الإصدار الأول.

## 5.2 Warehouses & Storage Locations

المسؤول عن تنظيم الهيكل المكاني للمخزون.

يشمل:

- Branches.
- Warehouses.
- Storage Zones.
- Shelves.
- Bins / Storage Locations.

النموذج المعتمد والمنفذ يدعم شركة واحدة لكل قاعدة بيانات. يتبع كل مخزن فرعًا واحدًا إلزاميًا. يُمثّل المخزن المركزي بفرع إداري صريح؛ لا يوجد مخزن مستقل بلا فرع ولا تبعية لعدة فروع. إدارة الشركات المتعددة مؤجلة.

المتطلبات:

- تعريف المخازن.
- تنظيم مواقع التخزين.
- ربط المواقع بالمخازن.
- تحديد حالة كل موقع.
- منع استخدام مواقع التخزين غير النشطة في العمليات الجديدة.
- دعم تعدد مستويات التخزين.
- توفير هيكل قابل للتوسع.

السلوك المنفذ في Phase 3:

- الفروع والمخازن ومواقع التخزين لها معرّفات ثابتة ورموز وحالة وتواريخ وإصدار للتعديل المتفائل.
- أنواع المواقع Zone / Shelf / Bin / Other وصفية ولا تفرض ترتيب مستويات ثابتًا. يمكن للموقع القابل للتخزين أن يحتوي مواقع فرعية؛ الموقع التنظيمي غير متاح للعمليات المخزنية.
- يُنشأ لكل مخزن موقع افتراضي جذري محمي وقابل للتخزين. تتبع حالته حالة المخزن، ولا يُنقل ولا تُلغى قابليته للتخزين.
- تعطيل فرع يتطلب تعطيل مخازنه. تعطيل مخزن أو موقع يخضع للأرصدة والمستندات المعلّقة والجرد والمواقع التابعة النشطة. إزالة قابلية التخزين ممنوعة أيضًا عند وجود تاريخ حركات.
- نقل موقع داخل المخزن يغيّر موضعه التنظيمي فقط، ويحافظ على معرّف الموقع والمخزن والأرصدة والمستندات والحركات. تُمنع الدورات والآباء من مخزن آخر والتعديلات المؤثرة على جرد مفتوح.
- تغيير الفرع المالك يتطلب مخزنًا معطلًا وفرع وجهة نشطًا، دون مخزون أو تاريخ حركات أو مستندات معلّقة أو جرد.
- الاستلام والصرف والتحويل والجرد والعكس تتحقق من نشاط الموقع وسلسلة آبائه والمخزن والفرع. المحاولات المطابقة لعملية معتمدة سابقًا تعيد نتيجتها الأصلية بعد التحقق من الصلاحية.
- الجرد يخص الموقع المحدد فقط ولا يجمع أرصدة أبنائه. الأرصدة مستقلة لكل معرّف موقع.
- الواجهات المنفذة: `/branches` و`/warehouses` و`/warehouses/:id` و`/warehouses/:id/locations`، مع العربية RTL والتحميل الكسول للهيكل.
- القراءة تتطلب `read`؛ الإنشاء والتعديل `warehouse`؛ الحالة `warehouse.status`؛ نقل الموقع `warehouse.reparent`؛ نقل التبعية `warehouse.reassign`. التحقق في Main/Application إلزامي، ولا تكفي إخفاء الأزرار.

راجع [قرارات Phase 3](docs/phase3-domain-decisions.md) و[دليل التشغيل](docs/phase3-operations.md). لا توجد واجهة حذف نهائي للتعريفات، ولا حجوزات أو تحويلات قيد النقل أو تقييم مالي ضمن هذا النطاق.

## 5.3 Inventory Management

المسؤول عن إدارة الأرصدة الفعلية.

يشمل:

- Stock Balances.
- Product Quantities.
- Warehouse Balances.
- Storage Location Balances.
- Available Quantities.
- Reserved Quantities عند اعتماد الحجز.
- Inventory History.

المتطلبات:

- معرفة رصيد كل صنف أو Variant داخل كل مخزن.
- معرفة الرصيد داخل كل Storage Location عند تفعيل التخزين التفصيلي.
- حساب الكميات باستخدام Base Unit.
- عدم تعديل الرصيد بطريقة تتجاوز Stock Operations.
- الاحتفاظ بتاريخ الحركات.
- توفير بنية تسمح بإضافة Inventory Valuation مستقبلًا.

## 5.4 Stock Operations

المسؤول عن جميع العمليات التي تؤثر على المخزون.

يشمل:

### Receiving

استلام المخزون وإضافة الكميات إلى المخزن.

### Issuing

صرف المخزون وخصم الكميات.

### Transfers

تحويل الكميات بين المخازن أو مواقع التخزين.

### Inventory Counting

إجراء الجرد الفعلي ومقارنته بالرصيد المسجل.

### Stock Adjustments

تسوية الفروقات الناتجة عن الجرد أو العمليات المصرح بها.

### Stock Movement Ledger

يجب تسجيل كل حركة مخزنية بصورة قابلة للتتبع.

كل عملية يجب أن تحافظ على سلامة البيانات، ويجب تنفيذ التغييرات المرتبطة بها داخل Database Transaction مناسبة.

مثال: تحويل 10 قطع من Warehouse A إلى Warehouse B:

1. التحقق من وجود الكمية المطلوبة.
2. خصم الكمية من المصدر.
3. إضافة الكمية إلى الوجهة.
4. تسجيل الحركات المرتبطة بالمستند.
5. اعتماد العملية بالكامل أو التراجع عنها بالكامل عند حدوث خطأ.

## 5.5 Users, Roles & Permissions

المسؤول عن التحكم في الوصول إلى النظام.

يشمل:

- User Management.
- Roles.
- Permissions.
- Authentication.
- User Status.
- Access Control.

المتطلبات:

- كل مستخدم له حساب مستقل.
- إمكانية التبديل بين المستخدمين على نفس الجهاز.
- تحديد الأدوار والصلاحيات.
- التحكم في الوصول إلى الموديولات والعمليات.
- الفصل بين Module Activation وUser Permissions.
- تسجيل العمليات المهمة باسم المستخدم المنفذ.

## 5.6 System Settings

المسؤول عن إعدادات التطبيق وتخصيصه.

يشمل:

- General Settings.
- Business Configuration.
- Module Activation.
- Feature Configuration.
- Application Preferences.
- Backup & Restore Settings.
- Localization Settings مستقبلًا عند الحاجة.

يجب أن تكون الإعدادات مركزية ومنظمة، مع منع أي إعداد غير صالح من التأثير على سلامة العمليات.

---

# 6. Design Patterns

سيتم اختيار Design Patterns بناءً على احتياج النظام، وليس لمجرد تطبيق أكبر عدد ممكن منها.

## 6.1 Repository Pattern

**Status: Recommended for Adoption**

المسؤول عن فصل Business Logic عن طريقة تخزين البيانات.

مثال:

ProductRepository:

- Create.
- FindById.
- FindBySku.
- Update.
- Deactivate.

تتعامل Application Layer مع Repository Interfaces، بينما يتم تنفيذها داخل Infrastructure.

## 6.2 Use Case / Application Service Pattern

**Status: Recommended for Adoption**

كل عملية Business أساسية يتم تمثيلها بواسطة Use Case واضح.

أمثلة:

- CreateProduct.
- UpdateProduct.
- CreateWarehouse.
- ReceiveStock.
- IssueStock.
- TransferStock.
- AdjustInventory.

هذا يمنع وضع قواعد العمل داخل React Components أو IPC Handlers.

## 6.3 Dependency Injection

**Status: Recommended for Adoption**

يتم تمرير Dependencies المطلوبة إلى Services وUse Cases بدل إنشائها داخليًا.

الفوائد:

- سهولة الاختبار.
- سهولة استبدال Implementations.
- تقليل الترابط بين المكونات.

يمكن البدء بـ Manual Dependency Injection دون الحاجة إلى DI Container معقد.

## 6.4 Unit of Work / Database Transactions

**Status: Recommended for Adoption**

يجب استخدام Database Transactions للعمليات التي تتكون من عدة تغييرات مترابطة.

مثال:

TransferStock:

- خصم من المخزن المصدر.
- إضافة إلى المخزن المستلم.
- تسجيل الحركات.
- تحديث المستند.

يجب أن تتم جميع هذه الخطوات بصورة ذرية Atomicity.

## 6.5 Strategy Pattern

**Status: Adopt When Needed**

مناسب عندما توجد عدة طرق لتنفيذ نفس العملية.

أمثلة:

- قواعد تحويل وحدات القياس.
- سياسات التعامل مع الكميات.
- طرق تنفيذ عمليات مختلفة مستقبلًا.

## 6.6 Factory Pattern

**Status: Adopt When Needed**

يمكن استخدامه لإنشاء أنواع مستندات المخزون أو كائنات العمليات المختلفة عندما يصبح هناك اختلاف حقيقي في قواعد الإنشاء.

لا يتم تطبيقه دون وجود حاجة فعلية.

## 6.7 Observer / Domain Events

**Status: Future Extension**

يمكن استخدام Domain Events للإعلان عن أحداث مهمة داخل النظام.

مثال:

StockReceiptPosted.

يتم تحديث الأرصدة داخل معاملة الاعتماد نفسها. يمكن نشر إشعارات بعد نجاح المعاملة.

يجب أن تكون معالجة الأحداث متوافقة مع معاملات قاعدة البيانات، وألا تؤدي إلى فقدان الاتساق.

## 6.8 Patterns Not Required in V1

لا يُوصى باستخدام الأنماط التالية في النسخة الأولى دون مبرر واضح:

- Microservices.
- Event Sourcing.
- CQRS الكامل.

السبب: تعقيد إضافي لا يتناسب مع حجم التطبيق وطبيعة تشغيله الحالية.

---

# 7. Stock Management Architecture

يجب الفصل بين ثلاثة مفاهيم رئيسية:

تملك وحدة Inventory مستندات المخزون وسجل الحركات والأرصدة. الاعتماد والعكس والتحويل الفوري عمليات ذرية. يمنع الرصيد السالب ويعيد تكرار نفس أمر الاعتماد نتيجته السابقة. يحتفظ كل سطر بوحدة الإدخال ومعامل التحويل وقت الاعتماد.

## 7.1 Stock Document

يمثل مستند العملية التجارية.

أمثلة:

- Receiving Document.
- Issuing Document.
- Transfer Document.
- Adjustment Document.

## 7.2 Stock Movement

يمثل حركة فعلية تؤثر على المخزون.

كل حركة يجب أن تكون مرتبطة بالمستند الذي أنشأها، مع الاحتفاظ بمعلومات كافية لتتبع مصدر الحركة ووجهتها.

## 7.3 Stock Balance

يمثل الرصيد الحالي لصنف أو Variant في مخزن أو موقع تخزين محدد.

### Core Principle

Stock Balance هو تمثيل للرصيد الحالي، بينما Stock Movement Ledger هو سجل تاريخي للتغيرات.

يجب ألا يسمح النظام بتغيير الرصيد مباشرة من أي Module خارج العمليات المخزنية المعتمدة.

### Document Lifecycle

يجب تصميم دورة حياة واضحة للمستندات، تشمل حالات مثل:

- Draft.
- Posted.
- Cancelled أو Reversed وفقًا لسياسة العمليات المعتمدة.

لا يجب حذف حركة مخزنية معتمدة بصورة تؤدي إلى فقدان التاريخ.

تتم معالجة الأخطاء في العمليات المعتمدة من خلال عمليات عكس أو تسوية موثقة، وفقًا لقواعد العمل النهائية.

---

# 8. Database Architecture

## 8.1 Database Technology

- SQLite.
- better-sqlite3.

قاعدة البيانات محلية، وتعمل دون اتصال بالإنترنت.

## 8.2 Database Design Principles

- Relational Database Design.
- Referential Integrity.
- Foreign Key Constraints.
- Unique Constraints.
- Appropriate Indexing.
- Database Transactions.
- Schema Migrations.
- Data Consistency.
- Historical Data Preservation.

## 8.3 Data Integrity

يجب تفعيل Foreign Keys واستخدام القيود المناسبة لمنع البيانات غير الصحيحة.

يجب ألا يتم حذف سجلات مرجعية مرتبطة بحركات تاريخية.

يتم استخدام Active / Inactive أو Soft Deactivation عند الحاجة.

## 8.4 Stock Data Consistency

يجب أن تكون جميع عمليات تحديث الأرصدة متوافقة مع سجل الحركات.

يجب أن تسمح البنية بإعادة مراجعة الأرصدة ومقارنتها بالحركات المسجلة.

تستخدم الأرصدة هوية stock_item_id وموقعًا تابعًا لمخزن واحد. المخزن البسيط له موقع افتراضي.

## 8.5 Quantity Precision

يجب اختيار طريقة تمثيل الكميات بدقة مناسبة، مع تجنب أخطاء Floating Point.

يجب توحيد قواعد التحويل والتقريب في جميع العمليات.

## 8.6 Future Financial Extension

على الرغم من أن الإصدار الأول يدير الكميات فقط، يجب عدم تصميم قاعدة البيانات بطريقة تمنع إضافة:

- Unit Cost.
- Inventory Valuation.
- Purchase Cost.
- Cost Layers.
- Accounting Integration.

لا يعني ذلك تنفيذ هذه الوظائف الآن.

## 8.7 Database Migrations

يجب توفير Migration System لإدارة تغييرات Schema.

كل Migration يجب أن يكون:

- مرقمًا أو محدد الإصدار.
- قابلًا للتتبع.
- قابلًا للاختبار.
- مصممًا لتجنب فقدان البيانات.

المخطط الحالي هو v8. يضيف v8 فهرسًا على موقع الرصيد لتسريع البحث حسب الموقع، ويحفظ صفوف الأرصدة والحركات كما هي. تُفحص سلامة القاعدة قبل الترقية، وتتوقف الترقية عند وجود بيانات غير صالحة لمعالجتها بشكل مستقل.

قبل ترقية أي قاعدة بيانات موجودة إلى v7 يجب إنشاء نسخة احتياطية تشمل الصور المرجعية، والتحقق من المخطط والسلامة والمفاتيح الخارجية والبصمات وإمكانية استعادة نسخة مؤقتة مستقلة. فشل التحقق يوقف الترقية ويحافظ على القاعدة القديمة. إنشاء قاعدة جديدة فارغة أو ترقية قاعدة سليمة من v7 إلى v8 لا يتطلب نسخة تاريخية إضافية. تبقى جميع الترحيلات المطبّقة ثابتة، وأي تصحيح مخطط مستقبلي يحتاج ترحيلًا أماميًا معتمدًا. اختبارات الترقية الداخلية لا تثبت توافق بناء v6 موزّع على العملاء دون التحقق من مصدره ومخططه الحقيقي.

## 8.8 Database File Location

يجب تخزين ملف قاعدة البيانات في مسار ثابت داخل بيانات التطبيق، وليس داخل مجلد تثبيت البرنامج.

هذا يضمن عدم فقدان بيانات العميل عند تحديث التطبيق أو إعادة تثبيته.

---

# 9. IPC & Security Architecture

## 9.1 Communication Flow

React Renderer → Preload API → IPC → Electron Main → Application Core → Infrastructure → SQLite.

## 9.2 Security Requirements

- تفعيل contextIsolation.
- تعطيل nodeIntegration في Renderer.
- عدم كشف Node.js APIs للواجهة.
- توفير Preload API محدودة.
- استخدام Typed IPC Contracts.
- التحقق من مدخلات العمليات داخل Application Layer.
- عدم اعتبار التحقق داخل الواجهة كافيًا.
- منع تنفيذ SQL من Renderer.
- منع الوصول العشوائي إلى IPC Channels.
- معالجة الأخطاء دون تسريب تفاصيل داخلية حساسة.

## 9.3 IPC Contract Design

يجب تعريف قنوات IPC واضحة لكل عملية.

أمثلة:

- products:create.
- products:update.
- products:find.
- warehouses:create.
- inventory:get-balance.
- stock:transfer.

يجب أن تكون Request / Response Contracts محددة ومكتوبة باستخدام TypeScript.

يفضل استخدام Zod للتحقق من المدخلات عند حدود النظام.

## 9.4 Authentication & Authorization

يجب التحقق من هوية المستخدم وصلاحياته عند تنفيذ العمليات الحساسة.

لا يكفي إخفاء زر في الواجهة؛ يجب التحقق من الصلاحية داخل Application Layer أو نقطة تنفيذ العملية.

---

# 10. Module Dependency Architecture

يجب تحديد حدود واضحة بين الموديولات.

أمثلة:

- Product Module مسؤول عن تعريف الأصناف.
- Warehouse Module مسؤول عن الهيكل المكاني.
- Inventory Module مسؤول عن الأرصدة.
- واجهة Stock Operations تستدعي خدمات Inventory لاعتماد كل حركة داخل معاملة واحدة.
- Users Module مسؤول عن الهوية والصلاحيات.
- Settings Module مسؤول عن إعدادات النظام.

لا يجب أن يقوم Module بتعديل جداول Module آخر مباشرة دون المرور بواجهة واضحة أو Use Case معتمد.

يجب منع Circular Dependencies.

ويفضل تحديد Module Contracts واضحة لتبادل البيانات والعمليات.

---

# 11. Business Flows

يجب تصميم وتوثيق التدفقات الأساسية قبل تنفيذها.

## 11.1 Product Creation Flow

1. استقبال بيانات المنتج.
2. التحقق من الحقول.
3. التحقق من SKU.
4. التحقق من التصنيف والوحدة والبراند.
5. إنشاء المنتج.
6. إنشاء المتغيرات إن وجدت.
7. حفظ البيانات.
8. إرجاع النتيجة.

## 11.2 Receiving Flow

1. إنشاء مستند استلام.
2. اختيار الأصناف أو المتغيرات.
3. تحديد الكميات والوحدات.
4. تحديد المخزن ومواقع التخزين عند الحاجة.
5. التحقق من صحة البيانات.
6. اعتماد المستند.
7. تسجيل الحركات.
8. تحديث الأرصدة داخل Transaction واحدة.

## 11.3 Issuing Flow

1. إنشاء مستند صرف.
2. اختيار الأصناف.
3. تحديد الكميات.
4. تحديد المخزن وموقع التخزين.
5. التحقق من الرصيد.
6. التحقق من الصلاحيات.
7. اعتماد المستند.
8. تسجيل الحركات وخصم الأرصدة.

## 11.4 Transfer Flow

1. تحديد المخزن المصدر.
2. تحديد المخزن الوجهة.
3. اختيار الأصناف والكميات.
4. التحقق من الرصيد المتاح.
5. التحقق من اختلاف المصدر والوجهة.
6. تسجيل عملية التحويل.
7. خصم المصدر.
8. إضافة الوجهة.
9. تسجيل الحركات.
10. اعتماد العملية بالكامل داخل Transaction واحدة.

## 11.5 Inventory Counting Flow

يُقفل الموقع حتى المراجعة والاعتماد أو الإلغاء. يسجل النظام الأرصدة المتوقعة عند بدء الجرد ويحفظ القفل بعد إعادة التشغيل.

1. إنشاء مستند جرد.
2. تحديد نطاق الجرد.
3. تسجيل الكميات الفعلية.
4. مقارنة الكميات الفعلية بالمسجلة.
5. احتساب الفروقات.
6. مراجعة واعتماد التسوية.
7. تسجيل حركات التسوية.
8. تحديث الأرصدة.

## 11.6 Authentication & Permission Flow

1. تسجيل دخول المستخدم.
2. التحقق من بيانات الدخول.
3. تحميل الأدوار والصلاحيات.
4. السماح أو منع العمليات حسب الصلاحيات.
5. تسجيل العمليات المهمة باسم المستخدم.

---

# 12. Testing Architecture

يجب تصميم الاختبارات بما يتوافق مع الطبقات والموديولات.

## 12.1 Unit Testing

اختبار:

- Domain Entities.
- Business Rules.
- Value Objects.
- Use Cases.
- Conversion Logic.
- Quantity Precision.
- Permission Rules.

يجب ألا تعتمد اختبارات Domain على SQLite أو Electron.

## 12.2 Integration Testing

اختبار التكامل بين:

- Application Layer.
- Repository Implementations.
- SQLite.
- Database Transactions.
- IPC Handlers عند الحاجة.

## 12.3 Critical Test Cases

تشمل اختبارات القبول تكرار الاعتماد بعد فقد الرد، وفشل أحد طرفي التحويل، ومنع الرصيد السالب عند العكس، وقفل نطاق الجرد وحماية نسخة البيانات قبل الترحيل والاستعادة.

- منع SKU المكرر.
- منع Barcode المكرر.
- منع استخدام صنف غير نشط في العمليات الجديدة.
- التحقق من وحدات القياس.
- اختبار تحويل الكميات.
- اختبار الكميات العشرية.
- منع صرف كمية أكبر من الرصيد المتاح.
- التأكد من عدم تحديث المخزون جزئيًا عند فشل التحويل.
- التأكد من تسجيل جميع الحركات.
- التحقق من الصلاحيات.
- اختبار Database Migrations.
- اختبار Backup & Restore.

## 12.4 Testing Tools

- Jest.
- Babel عند الحاجة إلى توافق بيئة الاختبار.
- SQLite Test Database.

يجب عزل قاعدة بيانات الاختبار عن قاعدة بيانات الاستخدام الفعلية.

---

# 13. Deployment & Runtime Architecture

## 13.1 Desktop Build

سيتم بناء التطبيق باستخدام Electron وإنتاج Windows Installer باستخدام NSIS.

## 13.2 Production Requirements

- تشغيل التطبيق دون إنترنت.
- تخزين البيانات محليًا.
- الحفاظ على قاعدة البيانات عند تحديث التطبيق.
- عدم وضع البيانات داخل مجلد التثبيت.
- التعامل مع أخطاء التشغيل وقاعدة البيانات.
- توفير آلية Backup & Restore.

## 13.3 Docker Compose

Docker ليس شرطًا لتشغيل المنتج النهائي على جهاز العميل.

يمكن استخدام Docker Compose لأغراض التطوير أو الاختبارات أو عمليات البناء عند وجود حاجة فعلية.

## 13.4 Updates

يجب تصميم آلية التحديث بحيث:

- لا تؤدي إلى فقدان البيانات.
- تتحقق من إصدار Schema.
- تنفذ Migrations المطلوبة.
- تحافظ على إمكانية استرجاع البيانات من Backup عند فشل التحديث.

---

# 14. Logging, Backup & Recovery

## 14.1 Logging

يجب توفير Structured Logging لتسجيل:

- أخطاء التطبيق.
- أخطاء قاعدة البيانات.
- فشل العمليات.
- أحداث التشغيل المهمة.
- عمليات التحديث والترحيل.

يجب تجنب تسجيل كلمات المرور أو البيانات الحساسة.

## 14.2 Backup

يجب توفير آلية نسخ احتياطي لقاعدة البيانات.

المتطلبات:

- إنشاء Backup يدوي.
- تحديد مكان الحفظ.
- التحقق من نجاح النسخ.
- الاحتفاظ بنسخ سابقة وفق سياسة قابلة للإعداد.

## 14.3 Restore

يجب توفير إمكانية استعادة نسخة احتياطية، مع التحقق من توافقها وسلامتها.

يجب ألا تتم عملية Restore دون حماية البيانات الحالية من الاستبدال غير المقصود.

---

# 15. Non-Functional Requirements

## 15.1 Performance

- استجابة سريعة للعمليات المحلية.
- استخدام Indexes مناسبة.
- تجنب تحميل بيانات غير مطلوبة.
- دعم Pagination في القوائم الكبيرة.
- تنفيذ عمليات قاعدة البيانات بطريقة لا تجمد واجهة المستخدم.

## 15.2 Reliability

- الحفاظ على اتساق الأرصدة.
- استخدام Transactions للعمليات الحساسة.
- منع فقدان البيانات.
- تسجيل الأخطاء.
- توفير Backup & Recovery.

## 15.3 Security

- Secure Electron Configuration.
- Authentication.
- Role-Based Access Control.
- Input Validation.
- Safe IPC.
- Local Data Protection.

## 15.4 Maintainability

- Modular Codebase.
- Clear Layer Responsibilities.
- Dependency Inversion.
- TypeScript.
- Automated Tests.
- Database Migrations.
- Consistent Error Handling.

## 15.5 Scalability

يجب أن تكون البنية قابلة لإضافة:

- Business Modules.
- Advanced Features.
- More Complex Inventory Rules.
- Costing.
- Accounting.
- External API Integration مستقبلًا.

---

# 16. Project Structure

`electron/main` owns bootstrap, database, recovery and IPC. `electron/preload` exposes the renderer bridge. `src/renderer` owns presentation. `src/core` contains application modules and their infrastructure. `src/shared` contains serializable contracts and pure utilities.

# 17. Implementation Roadmap

سيتم تنفيذ المشروع على مراحل.

## Phase 1 – Architecture & Foundation

- تثبيت Architecture.
- إعداد TypeScript.
- إعداد Electron.
- إعداد React وVite.
- إعداد Preload.
- إعداد Typed IPC.
- إعداد SQLite.
- إعداد Migration System.
- إعداد Dependency Injection.
- إعداد Error Handling.
- إعداد Logging.
- إعداد Testing Environment.

## Phase 2 – Product & Item Management

- Product Management.
- Categories.
- Units.
- Packaging Units.
- Brands.
- Variants.
- Barcodes.

## Phase 3 – Warehouses & Storage Locations

- Branches.
- Warehouses.
- Storage Zones.
- Shelves.
- Bins.
- Storage Locations.

الأساس المنفذ يشمل Domain/Application/SQLite v7 وIPC typed وRBAC والواجهات والتكامل مع Inventory. نتيجة الإغلاق التطويري وأدلتها موثقة في [التحقق النهائي](docs/phase3-final-validation.md)، ويظل قبول مثبّت Windows والإصدار الإنتاجي بوابة منفصلة.

## Phase 4 – Inventory Management

أساس الاستلام والصرف والتحويل الفوري والجرد والعكس والصلاحيات والسجل والمطابقة منفذ في Architecture V2 ومتكامل مع Phase 3. البنود اللاحقة تمثل خريطة منتج تاريخية والتوسع المستقبلي يتطلب اعتمادًا مستقلًا؛ إغلاق Phase 3 لا يبدأ Phase 4 تلقائيًا.

- Stock Balances.
- Available Quantities.
- Reserved Quantities عند اعتمادها.
- Inventory History.
- Balance Consistency.

## Phase 5 – Stock Operations

- Receiving.
- Issuing.
- Transfers.
- Counting.
- Adjustments.
- Stock Movement Ledger.

## Phase 6 – Users, Roles & Permissions

- Authentication.
- Users.
- Roles.
- Permissions.
- Access Control.

## Phase 7 – System Settings

- General Settings.
- Business Configuration.
- Module Activation.
- Feature Configuration.

## Phase 8 – Testing & Deployment

- Unit Tests.
- Integration Tests.
- Critical Business Flow Tests.
- Backup & Restore.
- Windows Build.
- NSIS Installer.
- Production Validation.

---

# 18. Architecture Decisions & Open Items

يجب التمييز بين القرارات المعتمدة والاقتراحات التي تحتاج مراجعة.

## 18.1 Established Product Decisions

- Desktop Application باستخدام Electron.
- React Frontend.
- SQLite Local Database.
- Offline Operation.
- Multi-user Accounts على نفس الجهاز بالتبادل.
- Modular Product Architecture.
- Core Modules Version 1.0.
- Optional Modules مستقبلًا.
- Product Variants.
- Simple Products وProducts With Variants.
- Base Unit لكل صنف.
- Multiple Packaging Units.
- Conversion Factors خاصة بالصنف.
- Whole وDecimal Quantities.
- Brands في الإصدار الأول.
- Multiple Barcodes.
- Barcode مرتبط بوحدة التعبئة عند الحاجة.
- Supplier Relationships مع تأجيل المشتريات.
- دعم التصنيفات الهرمية.
- عدم حذف البيانات المرتبطة بتاريخ حركات.

## 18.2 Recommended Technical Decisions

- Modular Monolith.
- Layered Architecture.
- Clean Architecture Principles.
- Independent Application Core.
- TypeScript.
- Repository Pattern.
- Use Case Pattern.
- Dependency Injection.
- Database Transactions.
- Typed IPC.
- Zod Validation.
- Structured Logging.
- Database Migrations.
- Unit and Integration Testing.

## 18.3 Architecture V2 decisions

[Architecture V2 decision records](docs/architecture-v2.md) govern stock identity, posting, counting, security, and recovery. Supplier-directory scope, scannable label output, and reference-PC performance targets await product acceptance. Deliver trusted identity, recovery and a verified receipt posting path before expanding inventory workflows.

Approved Phase 3 decisions are implemented as described in section 5.2 and [the operating guide](docs/phase3-operations.md). The receipt/issue/transfer/count/reversal foundation, trusted Identity and verified recovery are present; historical stage reports retain their original checkpoint scope. Development validation and installed-customer release acceptance are separate decisions.

# 19. Definition of Done

لا تعتبر أي Core Module مكتملة إلا عند تحقق الآتي:

1. وجود Domain Model واضح.
2. تحديد Business Rules.
3. وجود Use Cases للعمليات المطلوبة.
4. وجود Repository Interfaces وتنفيذها.
5. التحقق من صحة البيانات.
6. وجود Database Migrations.
7. وجود اختبارات Unit وIntegration المناسبة.
8. التحقق من الصلاحيات.
9. معالجة الأخطاء.
10. عدم السماح بتجاوز قواعد العمل من الواجهة أو IPC.
11. الحفاظ على سلامة البيانات.
12. توثيق العلاقات والاعتمادات مع باقي الموديولات.

---

# 20. Final Product Direction

الهدف النهائي هو بناء Warehouse Management System محلي، قابل للتخصيص والتوسع، يعتمد على Modular Monolith Architecture، ويحقق فصلًا واضحًا بين واجهة المستخدم وقواعد العمل والتخزين.

يجب أن تكون Business Logic مستقلة عن Electron وReact وSQLite قدر الإمكان، مع توفير حدود واضحة بين الموديولات، وضمان سلامة بيانات المخزون وسجل الحركات.

**Development Principle:**

Build a reliable Core first, preserve clear module boundaries, and extend the system through isolated business modules without rewriting the foundation.

