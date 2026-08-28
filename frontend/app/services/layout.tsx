import { Suspense } from "react";
import "@/src/features/commerce/commerce.css";
export default function Layout({children}:{children:React.ReactNode}){return <Suspense fallback={null}>{children}</Suspense>}
