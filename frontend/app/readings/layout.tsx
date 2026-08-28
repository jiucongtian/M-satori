import { Suspense } from "react";
import "@/src/features/legacy/legacy.css";
import "@/src/features/reading/reading-responsive.css";

export default function ReadingsLayout({children}:{children:React.ReactNode}) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
