// Content rules for the translated editions (tests/lib/rules.mjs): the banned-term scans and
// the "RIG is an agency, not a medical provider" scan that static-check runs on every zh/ar page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bannedTermsIn, providerTermsIn, arElativeHits, AR_ELATIVE_ALLOW } from "./lib/rules.mjs";

test("ar: the brief's two banned phrases, rendered as construct elatives, are caught", () => {
  // "Japan's finest licensed clinics" / "the most trusted gateway"
  assert.ok(bannedTermsIn("أرقى العيادات المرخّصة في اليابان", "ar").length > 0);
  assert.ok(bannedTermsIn("أكثر البوابات موثوقية", "ar").length > 0);
  assert.ok(bannedTermsIn("أكثر البوابات ثقةً", "ar").length > 0);
});

test("ar: elatives are caught by shape — construct, definite, prefixed, أكثر + quality noun", () => {
  for (const x of ["أمهر الأطباء", "أرفع المعايير", "أعلى المعايير", "أحدث العلاجات", "أفخم الفنادق", "أجود العيادات",
    "وأرقى العيادات", "بأحدث التقنيات", "أهم العيادات", "الأرقى", "للأحدث", "الأكثر موثوقية", "الأكثر تقدّماً",
    "أكثر العيادات أماناً", "عالمية المستوى"]) {
    assert.ok(bannedTermsIn(x, "ar").length > 0, x);
  }
  // shape detection on its own (not via the word list): an elative the list does not name
  assert.deepEqual(arElativeHits("أنقى العلاجات"), ["أنقى العلاجات"]);
});

test("ar: non-superlative words of the elative shape that the pages use are allowed", () => {
  for (const x of ["الحد الأقصى للرسائل", "عدد الأحرف المتبقية", "سيتواصل معكم أحد المنسّقين", "أولى تخصّصاتنا", "من أول حديث",
    "أكثر من عيادة", "من أجل المرضى", "وكالة رعاية صحية خاصة"]) {
    assert.deepEqual(bannedTermsIn(x, "ar"), [], x);
  }
  for (const [w, why] of Object.entries(AR_ELATIVE_ALLOW)) assert.ok(why.length > 2, `${w} needs a reason`);
});

test("zh: ad-law absolutes and safety guarantees are banned", () => {
  for (const x of ["首选", "极致", "尖端", "唯一", "独家", "首家", "国家级", "金牌", "王牌", "冠军", "No.1", "零风险", "无副作用", "绝对安全", "100%有效"]) {
    assert.ok(bannedTermsIn(`本机构为${x}`, "zh").includes(x), x);
  }
});

test("RIG is never described as a medical provider; partner clinics may be", () => {
  for (const x of ["一家私人医疗服务机构", "我们是医疗机构", "诊疗机构", "医疗服务提供者", "医疗服务商"]) assert.ok(providerTermsIn(x, "zh").length > 0, x);
  for (const x of ["私人医疗服务中介", "我们的合作医疗机构", "合作的医疗机构", "医疗协调员"]) assert.deepEqual(providerTermsIn(x, "zh"), [], x);
  for (const x of ["نحن مؤسسة طبية خاصة", "مقدّم رعاية صحية", "منشأة صحية", "مقدم الخدمات الطبية", "مزود رعاية صحية"]) assert.ok(providerTermsIn(x, "ar").length > 0, x);
  for (const x of ["وكالة رعاية صحية خاصة", "مؤسسة طبية شريكة", "حديث خاص حول مؤسستكم", "المؤسسة"]) assert.deepEqual(providerTermsIn(x, "ar"), [], x);
});
