const euro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const receiptDate = new Intl.DateTimeFormat("en-IE", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin",
});
const quantity = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 3 });

export const formatEuro = (value: number) => euro.format(value);
export const formatMinor = (cents: number) => formatEuro(cents / 100);
export const toMinor = (euros: number) => Math.round(euros * 100);
export const formatReceiptDate = (value: string) => receiptDate.format(new Date(value));
export const formatQuantity = (value: number) => quantity.format(value);
export const monthLabel = (month: string, style: "short" | "long" = "long") =>
  new Intl.DateTimeFormat("en-IE", { month: style, timeZone: "UTC" }).format(new Date(month + "-01"));
