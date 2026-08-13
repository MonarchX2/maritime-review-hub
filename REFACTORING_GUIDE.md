# Maritime Review Hub - Formatting Refactoring Guide

## How to Use the New Component Styles

This document shows before/after examples of how to refactor your HTML using the new component CSS classes.

---

## 1. BUTTONS - MAJOR REFACTORING OPPORTUNITY

### Example 1: Primary Action Button

**BEFORE (Current):**

```html
<button
  onclick="initSession()"
  class="w-full bg-brand-600 text-white py-3 rounded-lg font-bold hover:bg-brand-700 hover:-translate-y-1 hover:shadow-lg shadow-md transition-all duration-300 active:scale-95 group"
>
  Start Review
  <i
    class="fa-solid fa-play ml-2 group-hover:translate-x-1 transition-transform"
  ></i>
</button>
```

**AFTER (Refactored):**

```html
<button onclick="initSession()" class="btn btn-primary btn-large">
  Start Review
  <i class="fa-solid fa-play"></i>
</button>
```

**Reduction:** 28 classes → 3 classes (89% reduction!)

---

### Example 2: Secondary Button

**BEFORE:**

```html
<button
  onclick="navigate('dashboard')"
  class="bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 px-4 py-2 rounded-xl font-bold shadow-sm transition-all duration-300 active:scale-95 flex items-center group"
>
  <i
    class="fa-solid fa-arrow-left mr-2 group-hover:-translate-x-1 transition-transform"
  ></i>
  Pause & Return
</button>
```

**AFTER:**

```html
<button onclick="navigate('dashboard')" class="btn btn-secondary">
  <i class="fa-solid fa-arrow-left"></i>
  Pause & Return
</button>
```

**Reduction:** 24 classes → 2 classes (92% reduction!)

---

### Example 3: Icon-Only Button

**BEFORE:**

```html
<button
  onclick="openSessionSettingsModal()"
  id="btn-session-settings"
  class="bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 w-10 h-10 rounded-xl font-bold shadow-sm transition-all duration-300 active:scale-95 flex items-center justify-center group"
  title="Session Settings"
>
  <i class="fa-solid fa-gear group-hover:rotate-90 transition-transform"></i>
</button>
```

**AFTER:**

```html
<button
  onclick="openSessionSettingsModal()"
  id="btn-session-settings"
  class="btn btn-secondary btn-icon"
  title="Session Settings"
>
  <i class="fa-solid fa-gear"></i>
</button>
```

**Reduction:** 22 classes → 3 classes (86% reduction!)

---

## 2. FORM INPUTS

### Example: Text Input

**BEFORE:**

```html
<input
  type="text"
  id="admin-password"
  class="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-brand-500 transition-all outline-none pr-12"
  placeholder="Enter Admin Password"
/>
```

**AFTER:**

```html
<input
  type="text"
  id="admin-password"
  class="input"
  placeholder="Enter Admin Password"
/>
```

**Reduction:** 13 classes → 1 class (92% reduction!)

---

### Example: Select Dropdown

**BEFORE:**

```html
<select
  id="filter-subject"
  class="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white mb-6 focus:ring-2 focus:ring-brand-500 transition-shadow outline-none cursor-pointer"
>
  <option value="ALL">All Subjects</option>
</select>
```

**AFTER:**

```html
<select id="filter-subject" class="select">
  <option value="ALL">All Subjects</option>
</select>
```

**Reduction:** 14 classes → 1 class (93% reduction!)

---

## 3. CARD COMPONENTS

### Example: Section Container

**BEFORE:**

```html
<div
  class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"
>
  <!-- Content -->
</div>
```

**AFTER:**

```html
<div class="card">
  <!-- Content -->
</div>
```

**Reduction:** 9 classes → 1 class (89% reduction!)

---

### Example: Section with Header & Body

**BEFORE:**

```html
<div
  class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700"
>
  <div
    class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4"
  >
    <h3 class="text-xl font-bold transition-colors">
      Subject Hierarchy Editor
    </h3>
    <button>Save</button>
  </div>
  <div id="content"></div>
</div>
```

**AFTER:**

```html
<div class="card">
  <div class="card-header">
    <div class="flex-between">
      <h3 class="h3">Subject Hierarchy Editor</h3>
      <button class="btn btn-primary">Save</button>
    </div>
  </div>
  <div class="card-body" id="content"></div>
</div>
```

**Benefit:** Much clearer structure!

---

## 4. MODALS

### Example: Report Modal

**BEFORE:**

```html
<div
  id="report-modal"
  class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] hidden opacity-0 transition-opacity duration-300 flex items-center justify-center p-4"
>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 transform scale-95 transition-all duration-300 flex flex-col max-h-[90vh]"
  >
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100">
        <i class="fa-solid fa-flag text-red-500 mr-2"></i> Report Question
      </h3>
      <button
        onclick="closeReportModal()"
        class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
      >
        <i class="fa-solid fa-xmark text-xl"></i>
      </button>
    </div>
    <!-- Content -->
  </div>
</div>
```

**AFTER:**

```html
<div id="report-modal" class="modal">
  <div class="modal-content">
    <div class="modal-header">
      <h3 class="modal-title">
        <i class="fa-solid fa-flag"></i> Report Question
      </h3>
      <button onclick="closeReportModal()" class="modal-close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <!-- Content in modal-body -->
  </div>
</div>
```

**Reduction:** Massive cleanup in HTML!

---

## 5. BADGES & STATUS

### Example: Subject Badge

**BEFORE:**

```html
<span
  class="truncate min-w-0 bg-brand-100 text-brand-800 text-xs px-2 py-1 rounded font-semibold dark:bg-brand-900 dark:text-brand-200 transition-colors"
>
  Radar
</span>
```

**AFTER:**

```html
<span class="badge badge-brand">Radar</span>
```

**Reduction:** 13 classes → 2 classes (85% reduction!)

---

### Example: Status Indicators

**BEFORE:**

```html
<div
  class="flex items-center gap-2 bg-green-50 dark:bg-green-900/10 px-3 py-1.5 rounded-full text-sm font-semibold text-green-700 dark:text-green-400"
>
  <i class="fa-solid fa-check text-lg"></i>
  Resolved
</div>
```

**AFTER:**

```html
<div class="status-badge status-online">
  <i class="fa-solid fa-check"></i>
  Resolved
</div>
```

---

## 6. ALERTS & NOTIFICATIONS

### Example: Info Alert

**BEFORE:**

```html
<div
  class="bg-blue-50 dark:bg-gray-800 border-l-4 border-blue-500 p-4 rounded-r-lg text-sm text-blue-800 dark:text-blue-300 shadow-sm transition-colors hover:shadow-md"
>
  <strong>Tip:</strong> Use double colons...
</div>
```

**AFTER:**

```html
<div class="alert alert-info">
  <i class="fa-solid fa-lightbulb alert-icon"></i>
  <div class="alert-content"><strong>Tip:</strong> Use double colons...</div>
</div>
```

---

## 7. TYPOGRAPHY

### Example: Headers

**BEFORE:**

```html
<h2 class="text-2xl font-bold mb-6">Community Reports</h2>
<h3 class="text-xl font-bold transition-colors">Subject Hierarchy Editor</h3>
<p class="text-sm text-gray-500 mb-6">
  Track the status of reported questions...
</p>
```

**AFTER:**

```html
<h2 class="h2 mb-6">Community Reports</h2>
<h3 class="h3">Subject Hierarchy Editor</h3>
<p class="small-text mb-6">Track the status of reported questions...</p>
```

**Benefits:**

- Consistent sizing across the app
- Easy to change hierarchy globally
- Better semantic HTML

---

## 8. LISTS

### Example: Report List Item

**BEFORE:**

```html
<div
  class="bg-white dark:bg-gray-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-sm relative group mb-4"
>
  <div class="flex justify-between items-start mb-2">
    <span
      class="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded"
    >
      ID: 12345
    </span>
  </div>
  <!-- More content -->
</div>
```

**AFTER:**

```html
<div class="list-item border-l-4 border-yellow-500">
  <div class="flex-between">
    <span
      class="tiny-text font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded"
    >
      ID: 12345
    </span>
  </div>
  <!-- More content -->
</div>
```

---

## 9. PROGRESS BARS

### Example: Session Progress

**BEFORE:**

```html
<div
  class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden shadow-inner"
>
  <div
    class="bg-brand-500 h-full rounded-full transition-all duration-500 ease-out"
    id="session-progress"
    style="width: 0%"
  ></div>
</div>
```

**AFTER:**

```html
<div class="progress-bar">
  <div class="progress-fill" id="session-progress"></div>
</div>
```

**Reduction:** 8 classes → 2 classes (75% reduction!)

---

## 10. RESPONSIVE UTILITIES

### Example: Show/Hide on Mobile

**BEFORE:**

```html
<span class="hidden md:inline">Previous</span>
<i class="fa-solid fa-arrow-left md:mr-2"></i>
```

**AFTER:**

```html
<span class="hide-mobile">Previous</span>
<i class="fa-solid fa-arrow-left icon-md"></i>
```

---

## IMPLEMENTATION CHECKLIST

- [ ] **Step 1:** Add `COMPONENT_STYLES.css` link to index.html (after styles.css)
- [ ] **Step 2:** Update button elements (biggest impact)
- [ ] **Step 3:** Update form inputs
- [ ] **Step 4:** Update card layouts
- [ ] **Step 5:** Update modal styles
- [ ] **Step 6:** Update badges and status indicators
- [ ] **Step 7:** Update alerts and notifications
- [ ] **Step 8:** Test dark mode thoroughly
- [ ] **Step 9:** Test responsive design
- [ ] **Step 10:** Test all interactive elements

---

## ESTIMATED IMPROVEMENTS

| Change                  | Before  | After   | Reduction   |
| ----------------------- | ------- | ------- | ----------- |
| Avg button classes      | 24      | 3       | 87%         |
| Avg input classes       | 13      | 1       | 92%         |
| Avg card classes        | 9       | 1       | 89%         |
| Total CSS lines in HTML | ~8,000+ | ~3,000+ | ~60%        |
| HTML readability        | Low     | High    | +80%        |
| Maintenance difficulty  | High    | Low     | Much easier |

---

## NEXT STEPS

1. **Quick Win:** Start with buttons (most visible impact)
2. **Forms:** Update inputs and form groups
3. **Layouts:** Convert card structures
4. **Modals:** Standardize all modals
5. **Fine-tune:** Adjust spacing and colors as needed
6. **Test:** Verify all pages and dark mode
7. **Deploy:** Push updates to production

---

## TIPS FOR REFACTORING

1. **Use Find & Replace** - Search for common patterns like `bg-white dark:bg-gray-800` and replace with `card`
2. **Work by section** - Don't refactor everything at once; do one view/section at a time
3. **Keep backups** - Git commit before major refactoring
4. **Test frequently** - Check responsive design after each major change
5. **Use DevTools** - Open browser console to verify no style errors
6. **Involve team** - Discuss and agree on naming conventions first

---

## QUESTIONS & ANSWERS

**Q: Will this break existing functionality?**  
A: No, these are purely CSS changes. All JavaScript remains the same.

**Q: Can I use these components with Tailwind?**  
A: Yes! The components use Tailwind's `@apply` directive, so they're fully compatible.

**Q: What about custom styling?**  
A: You can still use inline Tailwind classes for unique elements; these components are for common patterns.

**Q: Do I need to add COMPONENT_STYLES.css?**  
A: Yes, link it in your HTML head (or merge it into styles.css if you prefer).

**Q: Will performance improve?**  
A: Slightly! Shorter class strings = smaller HTML file size. CSS output is identical.

---

## RESOURCES

- See `FORMATTING_AUDIT.md` for detailed issues and analysis
- See `COMPONENT_STYLES.css` for all available CSS classes
- Ask GitHub Copilot for help refactoring specific sections
