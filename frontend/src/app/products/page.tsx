import { PageShell } from "@/components/layout/page-shell";
import { ProductExplorer } from "@/components/products/product-explorer";

export default function ProductsPage() { return <PageShell requiresLedger={false}><ProductExplorer /></PageShell>; }
