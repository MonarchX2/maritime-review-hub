var MRH_REVIEWER_PDF_MAX_BYTES = 8 * 1024 * 1024;

function reviewerPdfWatermarkIdentity_(account, verifiedEmail) {
  var email = String(verifiedEmail || "").trim();
  var fullName = [
    account && account.firstName,
    account && account.middleInitial,
    account && account.lastName,
  ].filter(function (part) {
    return String(part || "").trim();
  }).join(" ");
  fullName = String(fullName)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName)
    throw new Error("Verified account details are required.");
  return { fullName: fullName, email: email };
}
