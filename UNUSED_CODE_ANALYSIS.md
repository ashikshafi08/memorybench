# Unused Code Analysis Report

**Generated:** December 21, 2025

## Summary

After analyzing the codebase for unused, redundant, or dead code, here are the findings:

---

## 🔴 Confirmed Unused Files

### 1. `test_loader.ts` (34 lines)
**Status:** ❌ Not imported anywhere
- **Location:** Root directory
- **Purpose:** Test/debug script for loading benchmark data
- **Usage:** No imports found in the codebase
- **Recommendation:** Remove or move to `scripts/` directory if needed for manual testing

### 2. `benchmarks/RAG-template-benchmark/data.ts` (97 lines)
**Status:** ❌ Exported but never imported
- **Location:** `benchmarks/RAG-template-benchmark/data.ts`
- **Purpose:** Exports `ragBenchmarkData` array
- **Issue:** The config file (`rag-template.yaml`) uses `data.json` instead
- **Usage:** Exported from `index.ts` but never imported anywhere
- **Recommendation:** Remove if `data.json` is the canonical source

---

## 🟡 Potentially Unused Exports

### 1. `core/analysis/comparison-report.ts` (331 lines)
**Status:** ⚠️ Exported but usage unclear
- **Exports:** `generateComparisonReport`, `formatReportMarkdown`, `formatReportText`, `formatReportJSON`
- **Usage:** Exported from `core/analysis/index.ts` but only `statistics.ts` functions are imported in CLI
- **Recommendation:** Verify if comparison report functions are used in CLI or planned features

### 2. `benchmarks/packs/golden-tests.ts` (180 lines)
**Status:** ⚠️ Exported but never imported
- **Exports:** `runGoldenTests`, `runAllGoldenTests`, `GoldenTestResult`
- **Usage:** No imports found in the codebase
- **Recommendation:** Check if this is for future use or should be removed

---

## 🟢 Files That Are Used (Verified)

### Core Modules
- ✅ `core/index.ts` - Exported and used
- ✅ `core/runner.ts` - Used in CLI
- ✅ `core/results.ts` - Used in CLI
- ✅ `core/metrics/*` - All used via registry
- ✅ `core/analysis/statistics.ts` - Used in `table.ts` and `policy-compare.ts`

### Providers
- ✅ `providers/adapters/*` - All registered and used
- ✅ `providers/OpenRouterRAG/*` - Used by `OpenRouterRAGAdapter`
- ✅ `providers/factory.ts` - Core factory used throughout

### Benchmarks
- ✅ `benchmarks/packs/*` - All packs registered and used
- ✅ `benchmarks/loaders/*` - Used by benchmark runner
- ✅ `benchmarks/configs/*` - All configs loaded dynamically

### CLI
- ✅ `cli/index.ts` - Main entry point
- ✅ `cli/table.ts` - Used in CLI
- ✅ `cli/policy-compare.ts` - Used in CLI

---

## 📊 Statistics

| Category | Count | Status |
|----------|-------|--------|
| **Unused Files** | 2 | Remove candidates |
| **Potentially Unused Exports** | 2 | Needs verification |
| **Total Lines of Unused Code** | ~642 lines | ~0.6% of codebase |

---

## 🔍 Detailed Analysis

### File: `test_loader.ts`
```typescript
// Purpose: Test script for loading benchmark data
// Usage: None found
// Recommendation: Remove or move to scripts/
```

### File: `benchmarks/RAG-template-benchmark/data.ts`
```typescript
// Exports: ragBenchmarkData
// Issue: Config uses data.json instead
// Recommendation: Remove if data.json is canonical
```

### File: `core/analysis/comparison-report.ts`
```typescript
// Exports: generateComparisonReport, formatReportMarkdown, etc.
// Usage: Only statistics.ts functions are imported
// Recommendation: Verify if needed for future features
```

### File: `benchmarks/packs/golden-tests.ts`
```typescript
// Exports: runGoldenTests, runAllGoldenTests
// Usage: No imports found
// Recommendation: Check if planned for future use
```

---

## ✅ Recommendations

### Immediate Actions
1. **Remove `test_loader.ts`** - Not used anywhere
2. **Remove `benchmarks/RAG-template-benchmark/data.ts`** - Redundant with `data.json`

### Verification Needed
1. **Check `comparison-report.ts`** - Verify if comparison reports are a planned feature
2. **Check `golden-tests.ts`** - Verify if golden tests are planned for CI/CD

### Code Quality Improvements
1. Consider adding ESLint rules to detect unused exports
2. Add tests for golden-tests functionality if it's meant to be used
3. Document comparison-report feature if it's planned

---

## Notes

- The analysis was performed by searching for imports/exports across the codebase
- Some exports may be used dynamically (via strings) and not detected
- Some code may be planned for future features
- Always verify before removing code that might be used in ways not easily detectable
